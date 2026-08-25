// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { fileRefSchema, isAllowedFileMimeType } from './schema';

describe('fileRefSchema', () => {
  it('accepts a valid file reference', () => {
    const result = fileRefSchema.safeParse({
      sha256: 'a'.repeat(64),
      filename: 'trumpet-part.pdf',
      mime: 'application/pdf',
      pageCount: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a sha256 that is not 64 characters', () => {
    const result = fileRefSchema.safeParse({
      sha256: 'too-short',
      filename: 'trumpet-part.pdf',
      mime: 'application/pdf',
      pageCount: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive page count', () => {
    const result = fileRefSchema.safeParse({
      sha256: 'a'.repeat(64),
      filename: 'trumpet-part.pdf',
      mime: 'application/pdf',
      pageCount: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('isAllowedFileMimeType', () => {
  it.each(['application/pdf', 'image/png', 'image/jpeg'])('allows %s', (mime) => {
    expect(isAllowedFileMimeType(mime)).toBe(true);
  });

  it.each(['application/zip', 'text/plain', 'image/gif'])('rejects %s', (mime) => {
    expect(isAllowedFileMimeType(mime)).toBe(false);
  });
});
