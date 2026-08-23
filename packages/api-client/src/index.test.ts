// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index';

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: () => Promise.resolve(response.body),
    }),
  );
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the right URL/method/body for createBand', async () => {
    mockFetchOnce({ ok: true, body: { id: '1', name: 'The Band', slug: 'the-band' } });
    const client = createApiClient('http://api.example');
    await client.createBand({ name: 'The Band' });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'The Band' }),
        credentials: 'include',
      }),
    );
  });

  it('builds nested invite URLs correctly', async () => {
    mockFetchOnce({ ok: true, body: [] });
    const client = createApiClient('http://api.example');
    await client.listInvites('band-1');

    expect(fetch).toHaveBeenCalledWith('http://api.example/bands/band-1/invites', expect.anything());
  });

  it('throws with the server-provided error message on a non-ok response', async () => {
    mockFetchOnce({ ok: false, status: 403, body: { error: 'Forbidden' } });
    const client = createApiClient('http://api.example');

    await expect(client.listBandMembers('band-1')).rejects.toThrow('Forbidden');
  });

  it('falls back to a generic message when the error body is unparseable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    const client = createApiClient('http://api.example');

    await expect(client.listBandMembers('band-1')).rejects.toThrow('Request failed with status 500');
  });
});
