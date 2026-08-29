// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// A hex-encoded SHA-256 digest — the only shape this value should ever take,
// since it becomes an object-storage key (`blobs/<sha256>`, see
// apps/server/src/lib/storage.ts) directly. Checking length alone would
// accept any 64-character string.
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

// A reference to one content-addressed file, as stored inline on a voice
// (packages/core/src/schemas/voice.ts) — not a foreign key to any table.
// `filename` is a display name only; identity is `sha256` (see
// docs/adr/0006-content-addressed-files.md).
export const fileRefSchema = z.object({
  sha256: sha256Schema,
  filename: z.string().min(1),
  mime: z.string().min(1),
  pageCount: z.number().int().positive(),
});

export type FileRef = z.infer<typeof fileRefSchema>;

export const ALLOWED_FILE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export type AllowedFileMimeType = (typeof ALLOWED_FILE_MIME_TYPES)[number];

export function isAllowedFileMimeType(mime: string): mime is AllowedFileMimeType {
  return (ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(mime);
}

/** Overridable via the server's MAX_FILE_SIZE_BYTES env var — this is only the fallback default. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const checkFileInputSchema = z.object({
  sha256: sha256Schema,
});

export type CheckFileInput = z.infer<typeof checkFileInputSchema>;

export const presignUploadInputSchema = z.object({
  sha256: sha256Schema,
  filename: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().positive(),
});

export type PresignUploadInput = z.infer<typeof presignUploadInputSchema>;

export const confirmFileInputSchema = presignUploadInputSchema;

export type ConfirmFileInput = z.infer<typeof confirmFileInputSchema>;
