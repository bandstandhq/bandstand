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
import { attachments } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import { deleteObject, getObjectBuffer, presignDownload, presignUpload } from '../lib/storage';

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
