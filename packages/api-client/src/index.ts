// SPDX-License-Identifier: Apache-2.0
import type {
  Band,
  BandMember,
  BandRole,
  CreateBandInput,
  CreateInviteInput,
  Invite,
  RedeemInviteInput,
  RenameBandInput,
  UpdateUserPrefsInput,
  UserPrefs,
} from '@bandstand/core';

interface ApiError {
  error: string;
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type MyBand = Band & { role: BandRole };

/**
 * 'member' and 'not-member' are authoritative (the server answered);
 * 'unknown' means the check itself failed (offline, timeout, 5xx) and
 * callers must not treat that as a denial — see
 * docs/adr/0006-offline-cache-scoping.md.
 */
export type MembershipCheckResult = 'member' | 'not-member' | 'unknown';

async function checkBandMembership(baseUrl: string, bandId: string): Promise<MembershipCheckResult> {
  try {
    // Reuses GET /bands/:bandId/members purely as a membership oracle — it
    // already requires 'member' role, so a 200/403 split is exactly the
    // answer this needs, with no dedicated endpoint.
    const res = await fetch(`${baseUrl}/bands/${bandId}/members`, { credentials: 'include' });
    if (res.ok) return 'member';
    if (res.status === 403) return 'not-member';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Typed client for apps/server's REST API. Server URL is configurable per
 * account/device, not hardcoded — see docs/ARCHITECTURE.md.
 */
export function createApiClient(baseUrl: string) {
  return {
    createBand: (input: CreateBandInput) =>
      request<Band>(baseUrl, '/bands', { method: 'POST', body: JSON.stringify(input) }),

    listMyBands: () => request<MyBand[]>(baseUrl, '/bands'),

    renameBand: (bandId: string, input: RenameBandInput) =>
      request<Band>(baseUrl, `/bands/${bandId}`, { method: 'PATCH', body: JSON.stringify(input) }),

    listBandMembers: (bandId: string) =>
      request<BandMember[]>(baseUrl, `/bands/${bandId}/members`),

    checkBandMembership: (bandId: string) => checkBandMembership(baseUrl, bandId),

    createInvite: (bandId: string, input: CreateInviteInput) =>
      request<Invite>(baseUrl, `/bands/${bandId}/invites`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    listInvites: (bandId: string) => request<Invite[]>(baseUrl, `/bands/${bandId}/invites`),

    revokeInvite: (bandId: string, inviteId: string) =>
      request<Invite>(baseUrl, `/bands/${bandId}/invites/${inviteId}/revoke`, { method: 'POST' }),

    redeemInvite: (input: RedeemInviteInput) =>
      request<{ band: Band; role: BandRole }>(baseUrl, '/invites/redeem', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getMyPrefs: () => request<UserPrefs>(baseUrl, '/me/prefs'),

    updateMyPrefs: (input: UpdateUserPrefsInput) =>
      request<UserPrefs>(baseUrl, '/me/prefs', { method: 'PATCH', body: JSON.stringify(input) }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
