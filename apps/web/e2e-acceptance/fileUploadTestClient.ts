// SPDX-License-Identifier: Apache-2.0
//
// Uploads a real fixture file into a band via the actual client-facing REST
// flow (presign-upload → PUT → confirm, see apps/server/src/routes/files.ts)
// rather than reaching into MinIO/Postgres directly. A band's
// content-addressed attachment ledger is per-band (docs/adr/0007), so a
// fresh throwaway band needs its own /confirm even for bytes that already
// sit in the bucket under some other band's ledger entry.
import { readFile } from 'node:fs/promises';
import { sha256Hex } from '@bandstand/core';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

export interface UploadedTestFile {
  sha256: string;
  filename: string;
  mime: string;
}

export async function uploadFileToBand(
  token: string,
  bandId: string,
  filePath: string,
  filename: string,
  mime: string,
): Promise<UploadedTestFile> {
  const bytes = await readFile(filePath);
  const sha256 = await sha256Hex(bytes);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const presignRes = await fetch(`${SERVER_URL}/bands/${bandId}/files/presign-upload`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256, filename, mime, size: bytes.byteLength }),
  });
  if (!presignRes.ok) throw new Error(`presign-upload failed: ${presignRes.status} ${await presignRes.text()}`);
  const { uploadUrl } = (await presignRes.json()) as { uploadUrl: string };

  const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
  if (!putRes.ok) throw new Error(`upload PUT failed: ${putRes.status}`);

  const confirmRes = await fetch(`${SERVER_URL}/bands/${bandId}/files/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256, filename, mime, size: bytes.byteLength }),
  });
  if (!confirmRes.ok) throw new Error(`confirm failed: ${confirmRes.status} ${await confirmRes.text()}`);

  return { sha256, filename, mime };
}
