// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Content-addressed file storage — see docs/adr/0007-content-addressed-files.md
// and docs/adr/0015-staged-uploads.md. The server never sees file bytes for
// a normal upload/download: the client uploads/downloads directly against
// MinIO via a presigned URL. The only bytes this route reads are during
// /confirm, where the server re-hashes what actually landed in the bucket
// to verify the client didn't lie about its content, since a presigned PUT
// lets a client upload anything.
//
// A presigned upload PUTs to a *band-scoped staging key*, never straight
// into the shared, deduplicated `blobs/<sha256>` namespace — see
// storage.ts's own header comment. That's what makes the shared namespace
// write-once from any client's perspective: the only way bytes ever land at
// `blobs/<sha256>` is this route's own `promoteStagingObject` call, and only
// once it has re-hashed *this band's own* staging object and confirmed it
// actually matches `sha256`. A mismatch deletes the staging object and
// nothing else — the shared namespace, and every other band's data in it,
// is simply never touched by a failed confirm.
import {
  can,
  checkFileInputSchema,
  confirmFileInputSchema,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  isAllowedFileMimeType,
  presignUploadInputSchema,
  sha256Hex,
} from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { attachments, pendingUploads } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import {
  deleteStagingObject,
  getStagingObjectStream,
  headStagingObject,
  presignDownload,
  presignStagingUpload,
  PRESIGN_EXPIRY_SECONDS,
  promoteStagingObject,
} from '../lib/storage';

const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES ?? DEFAULT_MAX_FILE_SIZE_BYTES);

export const filesRoute = new Hono<{ Variables: BandVariables }>();

filesRoute.use('*', requireBandRole('member'));

/** "Does this band already have this blob?" — lets the client skip the upload entirely on a hit. */
filesRoute.post('/check', async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const { sha256 } = checkFileInputSchema.parse(await c.req.json());

  const [existing] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.bandId, bandId), eq(attachments.sha256, sha256)));

  return c.json({ exists: !!existing });
});

filesRoute.post('/presign-upload', async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  if (!can(c.get('bandRole'), 'file:upload')) return c.json({ error: 'Forbidden' }, 403);

  const body = presignUploadInputSchema.parse(await c.req.json());
  if (!isAllowedFileMimeType(body.mime)) return c.json({ error: 'Unsupported file type' }, 415);
  if (body.size > MAX_FILE_SIZE_BYTES) return c.json({ error: 'File too large' }, 413);

  // Marks that this band, specifically, asked for a presigned PUT for this
  // hash — /confirm below requires this row (recent enough to still match a
  // live presigned URL) before it will even look for a staged object. Since
  // the PUT itself now goes to a *band-scoped* staging key (see storage.ts),
  // the staged object's mere existence is already proof this band's own
  // upload happened — unlike the old shared-namespace design, there's no
  // `LastModified`-baseline to record or compare here at all.
  await db
    .insert(pendingUploads)
    .values({ bandId, sha256: body.sha256, presignedAt: new Date() })
    .onConflictDoUpdate({
      target: [pendingUploads.bandId, pendingUploads.sha256],
      set: { presignedAt: new Date() },
    });

  const uploadUrl = await presignStagingUpload(bandId, body.sha256, body.mime);
  return c.json({ uploadUrl });
});

/** Called after the client's own PUT to the presigned URL succeeds — re-verifies the hash server-side. */
filesRoute.post('/confirm', async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  if (!can(c.get('bandRole'), 'file:upload')) return c.json({ error: 'Forbidden' }, 403);

  const body = confirmFileInputSchema.parse(await c.req.json());
  const userId = c.get('userId');

  const [pending] = await db
    .select({ presignedAt: pendingUploads.presignedAt })
    .from(pendingUploads)
    .where(and(eq(pendingUploads.bandId, bandId), eq(pendingUploads.sha256, body.sha256)));

  // Always consume the pending record, whatever the outcome — it's a
  // one-time ticket, not a standing grant.
  await db
    .delete(pendingUploads)
    .where(and(eq(pendingUploads.bandId, bandId), eq(pendingUploads.sha256, body.sha256)));

  // Bounded by the presigned URL's own lifetime — a ticket this old could
  // otherwise sit around indefinitely and later be "cashed in" against
  // whatever unrelated object happens to land in this band's staging area
  // much later.
  const presignExpired = !pending || Date.now() - pending.presignedAt.getTime() > PRESIGN_EXPIRY_SECONDS * 1000;
  if (presignExpired) {
    return c.json({ error: 'No pending upload for this band and hash — call presign-upload first' }, 403);
  }

  // The staging key is band-scoped (staging/<bandId>/<sha256>), so its mere
  // existence already proves *this band's own* PUT happened — no
  // `LastModified`-baseline comparison needed at all (see storage.ts and
  // docs/adr/0015-staged-uploads.md).
  const staged = await headStagingObject(bandId, body.sha256);
  if (!staged) {
    return c.json({ error: 'No staged upload found for this band and hash' }, 403);
  }

  // TODO: hash while streaming instead of buffering the whole file first
  // (see the size/streaming follow-up) — sha256Hex only takes a full
  // buffer today, so this reads the entire staged object into memory.
  const stream = await getStagingObjectStream(bandId, body.sha256);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const actualHash = await sha256Hex(buffer);
  if (actualHash !== body.sha256) {
    // Only ever the *staging* object — this band's own mistake never
    // reaches, let alone deletes, the shared `blobs/` namespace another
    // band may already depend on for this exact hash.
    await deleteStagingObject(bandId, body.sha256);
    return c.json({ error: 'Uploaded content does not match the claimed hash' }, 422);
  }

  await promoteStagingObject(bandId, body.sha256);
  await deleteStagingObject(bandId, body.sha256);

  await db
    .insert(attachments)
    .values({ bandId, sha256: body.sha256, filename: body.filename, mime: body.mime, size: body.size, uploadedBy: userId })
    .onConflictDoNothing({ target: [attachments.bandId, attachments.sha256] });

  return c.json({ ok: true });
});

filesRoute.get('/:sha256/presign-download', async (c) => {
  const bandId = c.req.param('bandId');
  const sha256 = c.req.param('sha256');
  if (!bandId || !sha256) return c.json({ error: 'Missing params' }, 400);

  const [existing] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.bandId, bandId), eq(attachments.sha256, sha256)));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const downloadUrl = await presignDownload(sha256);
  return c.json({ downloadUrl });
});
