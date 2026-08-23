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
