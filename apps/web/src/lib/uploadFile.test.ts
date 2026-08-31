// SPDX-License-Identifier: Apache-2.0
import type { ApiClient } from '@bandstand/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsecureContextError, uploadFileToBand } from './uploadFile';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFileToBand', () => {
  it('throws InsecureContextError instead of a bare TypeError when crypto.subtle is unavailable', async () => {
    // Simulates the app being reached over a plain http:// LAN address
    // (e.g. http://192.168.x.x), where browsers don't expose crypto.subtle.
    vi.stubGlobal('crypto', {});
    const file = new File(['%PDF-1.4'], 'score.pdf', { type: 'application/pdf' });

    await expect(uploadFileToBand({} as ApiClient, 'band-1', file)).rejects.toBeInstanceOf(
      InsecureContextError,
    );
  });
});
