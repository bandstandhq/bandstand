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

  it('requests the right URL/method for deleteBand', async () => {
    mockFetchOnce({ ok: true, body: { ok: true } });
    const client = createApiClient('http://api.example');
    await client.deleteBand('band-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('requests the right URL/method/body for resolveIdeaTie', async () => {
    mockFetchOnce({ ok: true, body: { resolution: 'archived' } });
    const client = createApiClient('http://api.example');
    await client.resolveIdeaTie('band-1', 'song-1', { resolution: 'archived' });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/songs/song-1/resolve-tie',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ resolution: 'archived' }) }),
    );
  });

  it('requests the right URL/method/body for updateMyInstruments', async () => {
    mockFetchOnce({ ok: true, body: { instruments: ['Guitar'] } });
    const client = createApiClient('http://api.example');
    await client.updateMyInstruments('band-1', { instruments: ['Guitar'] });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/members/me',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ instruments: ['Guitar'] }) }),
    );
  });

  it('requests the right URL/method for leaveBand', async () => {
    mockFetchOnce({ ok: true, body: { ok: true } });
    const client = createApiClient('http://api.example');
    await client.leaveBand('band-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/members/me',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('requests the right URL/method/body for changeMemberRole', async () => {
    mockFetchOnce({ ok: true, body: { userId: 'user-1', role: 'admin' } });
    const client = createApiClient('http://api.example');
    await client.changeMemberRole('band-1', 'user-1', { role: 'admin' });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/members/user-1/role',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }),
    );
  });

  it('requests the right URL/method for removeMember', async () => {
    mockFetchOnce({ ok: true, body: { ok: true } });
    const client = createApiClient('http://api.example');
    await client.removeMember('band-1', 'user-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/members/user-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('requests the right URL/method for transferOwnership', async () => {
    mockFetchOnce({ ok: true, body: { ok: true } });
    const client = createApiClient('http://api.example');
    await client.transferOwnership('band-1', 'user-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/members/user-1/transfer-ownership',
      expect.objectContaining({ method: 'POST' }),
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

  it('requests the right URL/method/body for updateMyPrefs', async () => {
    mockFetchOnce({ ok: true, body: { personalTranspose: 2 } });
    const client = createApiClient('http://api.example');
    await client.updateMyPrefs({ personalTranspose: 2 });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/me/prefs',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ personalTranspose: 2 }) }),
    );
  });

  it('checkBandMembership reports "member" on a 200 and "not-member" on a 403', async () => {
    mockFetchOnce({ ok: true, status: 200, body: [] });
    const client = createApiClient('http://api.example');
    await expect(client.checkBandMembership('band-1')).resolves.toBe('member');

    mockFetchOnce({ ok: false, status: 403, body: { error: 'Forbidden' } });
    await expect(client.checkBandMembership('band-1')).resolves.toBe('not-member');
  });

  it('checkBandMembership reports "unknown" on a network failure or an unrelated status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const client = createApiClient('http://api.example');
    await expect(client.checkBandMembership('band-1')).resolves.toBe('unknown');

    mockFetchOnce({ ok: false, status: 500, body: { error: 'Internal Server Error' } });
    await expect(client.checkBandMembership('band-1')).resolves.toBe('unknown');
  });

  it('calls onUnauthorized exactly on a 401, not on a 403 or a success', async () => {
    const onUnauthorized = vi.fn();
    const client = createApiClient('http://api.example', { onUnauthorized });

    mockFetchOnce({ ok: true, body: [] });
    await client.listMyBands();
    expect(onUnauthorized).not.toHaveBeenCalled();

    mockFetchOnce({ ok: false, status: 403, body: { error: 'Forbidden' } });
    await expect(client.listBandMembers('band-1')).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();

    mockFetchOnce({ ok: false, status: 401, body: { error: 'Unauthorized' } });
    await expect(client.listBandMembers('band-1')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('deleteEvent omits the query string by default and adds ?scope=series when asked', async () => {
    mockFetchOnce({ ok: true, body: { ok: true } });
    const client = createApiClient('http://api.example');
    await client.deleteEvent('band-1', 'event-1');
    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/events/event-1',
      expect.objectContaining({ method: 'DELETE' }),
    );

    mockFetchOnce({ ok: true, body: { ok: true } });
    await client.deleteEvent('band-1', 'event-1', 'series');
    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/events/event-1?scope=series',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('requests the right URL/method/body for closePoll', async () => {
    mockFetchOnce({ ok: true, body: { ok: true, eventId: 'event-1' } });
    const client = createApiClient('http://api.example');
    await client.closePoll('band-1', 'poll-1', { optionId: 'opt-1', title: 'Agreed rehearsal', type: 'rehearsal' });

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/bands/band-1/polls/poll-1/close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ optionId: 'opt-1', title: 'Agreed rehearsal', type: 'rehearsal' }),
      }),
    );
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
