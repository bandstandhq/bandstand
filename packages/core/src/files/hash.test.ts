// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector for "hello world"', async () => {
    const bytes = new TextEncoder().encode('hello world');
    await expect(sha256Hex(bytes)).resolves.toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('matches the known SHA-256 test vector for the empty string', async () => {
    await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces different hashes for different content', async () => {
    const a = await sha256Hex(new TextEncoder().encode('a'));
    const b = await sha256Hex(new TextEncoder().encode('b'));
    expect(a).not.toBe(b);
  });
});
