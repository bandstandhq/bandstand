// SPDX-License-Identifier: Apache-2.0
//
// Client side of the content-addressed upload flow (docs/adr/0007). Hashing
// happens here, before anything is sent, so `checkFileExists` can skip the
// PUT entirely when the band already has this exact content — five
// musicians uploading the same leadsheet transfer it once.
import { isAllowedFileMimeType, sha256Hex, type FileRef } from '@bandstand/core';
import type { ApiClient } from '@bandstand/api-client';

async function countPages(file: File): Promise<number> {
  if (file.type !== 'application/pdf') return 1;
  // Dynamic import: pdf.js is a large dependency that most songs (plain
  // ChordPro) never need — loading it only when a PDF is actually being
  // uploaded keeps it out of the app's main bundle.
  const { pdfjsLib } = await import('./pdfjs');
  // `destroy()` lives on the loading task, not the resolved document proxy.
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await loadingTask.promise;
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

export class UnsupportedFileTypeError extends Error {}

// `crypto.subtle` (needed below, for the content hash) is only exposed by
// browsers in a secure context — https://, or http://localhost — never on a
// plain http:// origin, which is exactly how this app is normally reached
// over a home/rehearsal LAN (e.g. http://192.168.x.x:5173). Without this
// check, sha256Hex's own `crypto.subtle.digest(...)` call throws a bare
// TypeError that the generic catch below would show as a misleading
// "try again" — retrying identically fails every time on that origin.
export class InsecureContextError extends Error {}

/**
 * Uploads `file` to `bandId`'s content store if it isn't already there, and
 * returns the `FileRef` to attach to a voice. Never re-uploads a hash the
 * band already has.
 */
export async function uploadFileToBand(apiClient: ApiClient, bandId: string, file: File): Promise<FileRef> {
  if (!isAllowedFileMimeType(file.type)) {
    throw new UnsupportedFileTypeError(`Unsupported file type: ${file.type}`);
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new InsecureContextError('crypto.subtle is unavailable outside a secure context (https:// or http://localhost).');
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const pageCount = await countPages(file);

  const { exists } = await apiClient.checkFileExists(bandId, sha256);
  if (!exists) {
    const { uploadUrl } = await apiClient.presignFileUpload(bandId, {
      sha256,
      filename: file.name,
      mime: file.type,
      size: file.size,
    });
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error(`Upload failed with status ${putRes.status}`);
    await apiClient.confirmFileUpload(bandId, { sha256, filename: file.name, mime: file.type, size: file.size });
  }

  return { sha256, filename: file.name, mime: file.type, pageCount };
}
