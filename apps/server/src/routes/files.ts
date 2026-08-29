// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Content-addressed file storage — see docs/adr/0007-content-addressed-files.md.
// The server never sees file bytes for a normal upload/download: the client
// uploads/downloads directly against MinIO via a presigned URL. The only
// bytes this route reads are during /confirm, where the server re-hashes
// what actually landed in the bucket to verify the client didn't lie about
// its content, since a presigned PUT lets a client upload anything.
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
  deleteObject,
  getObjectBuffer,
  headObject,
  presignDownload,
  presignUpload,
  PRESIGN_EXPIRY_SECONDS,
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
  // live presigned URL) and requires proof the object was actually
  // rewritten since. Without it, /confirm only ever checked that *some*
  // object existed at the content-addressed key — satisfiable by any band
  // for a hash it never uploaded, since the object store's namespace is
  // global, not band-scoped. `baselineLastModified` is this object's
  // current state (or "doesn't exist yet") *before* the upload this call is
  // about to authorize — see pendingUploads.ts for why /confirm compares
  // against it instead of this server's own clock.
  const baseline = await headObject(body.sha256);
  await db
    .insert(pendingUploads)
    .values({ bandId, sha256: body.sha256, presignedAt: new Date(), baselineLastModified: baseline?.lastModified })
    .onConflictDoUpdate({
      target: [pendingUploads.bandId, pendingUploads.sha256],
      set: { presignedAt: new Date(), baselineLastModified: baseline?.lastModified },
    });

  const uploadUrl = await presignUpload(body.sha256, body.mime);
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
    .select({ presignedAt: pendingUploads.presignedAt, baselineLastModified: pendingUploads.baselineLastModified })
    .from(pendingUploads)
    .where(and(eq(pendingUploads.bandId, bandId), eq(pendingUploads.sha256, body.sha256)));

  // Always consume the pending record, whatever the outcome — it's a
  // one-time ticket, not a standing grant.
  await db
    .delete(pendingUploads)
    .where(and(eq(pendingUploads.bandId, bandId), eq(pendingUploads.sha256, body.sha256)));

  // Bounded by the presigned URL's own lifetime — a ticket this old could
  // otherwise sit around indefinitely and later be "cashed in" against
  // whatever unrelated object happens to land at this hash much later.
  const presignExpired = !pending || Date.now() - pending.presignedAt.getTime() > PRESIGN_EXPIRY_SECONDS * 1000;
  if (presignExpired) {
    return c.json({ error: 'No pending upload for this band and hash — call presign-upload first' }, 403);
  }

  const head = await headObject(body.sha256);
  // No clock-skew tolerance needed: both readings are the object store's
  // own `LastModified`, taken at presign time and now, never this server's
  // clock — so "strictly newer" is exact, not approximate.
  const isFreshUpload =
    head?.lastModified !== undefined &&
    (pending.baselineLastModified === null || head.lastModified.getTime() > pending.baselineLastModified.getTime());
  if (!isFreshUpload) {
    // The object at this hash is exactly as it was before this band's own
    // presign-upload call — it was written by someone else's earlier
    // upload, not this request.
    return c.json({ error: 'No fresh upload found for this band and hash' }, 403);
  }

  const buffer = await getObjectBuffer(body.sha256);
  const actualHash = await sha256Hex(buffer);
  if (actualHash !== body.sha256) {
    await deleteObject(body.sha256);
    return c.json({ error: 'Uploaded content does not match the claimed hash' }, 422);
  }

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
