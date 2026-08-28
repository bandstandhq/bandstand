// SPDX-License-Identifier: Apache-2.0
import type {
  AnnotationObject,
  Band,
  BandMember,
  BandRole,
  ChangeMemberRoleInput,
  ClosePollInput,
  ConfirmFileInput,
  CreateAnnotationLayerInput,
  CreateBandInput,
  CreateInviteInput,
  Invite,
  PresignUploadInput,
  PushTriggers,
  RedeemInviteInput,
  RenameBandInput,
  ResolveIdeaTieInput,
  SubscribePushInput,
  UpdateAnnotationLayerInput,
  UpdateMyInstrumentsInput,
  UpdateUserPrefsInput,
  UserPrefs,
} from '@bandstand/core';

export interface AnnotationLayerDto {
  id: string;
  voiceId: string;
  name: string;
  objects: AnnotationObject[];
  shared: boolean;
  sourceLayerId: string | null;
  updatedAt: string;
}

interface ApiError {
  error: string;
}

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit | undefined,
  onUnauthorized: (() => void) | undefined,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    // A 401 means the local session is no longer valid at all (expired,
    // revoked, never existed) — every caller would otherwise have to
    // handle that identically, so it's centralized here instead. A 403
    // (a real session, just not allowed to do this) is NOT handled here:
    // it's a normal, per-call error the caller already surfaces its own
    // way (e.g. a form's own error message), not a reason to sign out.
    if (res.status === 401) onUnauthorized?.();
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

export interface ApiClientOptions {
  /** Called once per request that comes back 401 — the caller decides what "no longer signed in" means (e.g. clearing the local session). */
  onUnauthorized?: () => void;
}

/**
 * Typed client for apps/server's REST API. Server URL is configurable per
 * account/device, not hardcoded — see docs/ARCHITECTURE.md.
 */
export function createApiClient(baseUrl: string, options: ApiClientOptions = {}) {
  const { onUnauthorized } = options;
  const req = <T>(path: string, init?: RequestInit) => request<T>(baseUrl, path, init, onUnauthorized);

  return {
    createBand: (input: CreateBandInput) =>
      req<Band>('/bands', { method: 'POST', body: JSON.stringify(input) }),

    listMyBands: () => req<MyBand[]>('/bands'),

    renameBand: (bandId: string, input: RenameBandInput) =>
      req<Band>(`/bands/${bandId}`, { method: 'PATCH', body: JSON.stringify(input) }),

    deleteBand: (bandId: string) => req<{ ok: true }>(`/bands/${bandId}`, { method: 'DELETE' }),

    listBandMembers: (bandId: string) => req<BandMember[]>(`/bands/${bandId}/members`),

    updateMyInstruments: (bandId: string, input: UpdateMyInstrumentsInput) =>
      req<{ instruments: string[] }>(`/bands/${bandId}/members/me`, { method: 'PATCH', body: JSON.stringify(input) }),

    leaveBand: (bandId: string) => req<{ ok: true }>(`/bands/${bandId}/members/me`, { method: 'DELETE' }),

    changeMemberRole: (bandId: string, userId: string, input: ChangeMemberRoleInput) =>
      req<{ userId: string; role: BandRole }>(`/bands/${bandId}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    removeMember: (bandId: string, userId: string) =>
      req<{ ok: true }>(`/bands/${bandId}/members/${userId}`, { method: 'DELETE' }),

    transferOwnership: (bandId: string, userId: string) =>
      req<{ ok: true }>(`/bands/${bandId}/members/${userId}/transfer-ownership`, { method: 'POST' }),

    resolveIdeaTie: (bandId: string, songId: string, input: ResolveIdeaTieInput) =>
      req<{ resolution: ResolveIdeaTieInput['resolution'] }>(`/bands/${bandId}/songs/${songId}/resolve-tie`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    getSongDeleteImpact: (bandId: string, songId: string) =>
      req<{ affectedSetlists: string[]; hasPersonalNotes: boolean }>(
        `/bands/${bandId}/songs/${songId}/delete-impact`,
      ),

    deleteSongForever: (bandId: string, songId: string) =>
      req<{ affectedSetlists: string[] }>(`/bands/${bandId}/songs/${songId}`, { method: 'DELETE' }),

    deleteSetlist: (bandId: string, setlistId: string) =>
      req<{ ok: true }>(`/bands/${bandId}/setlists/${setlistId}`, { method: 'DELETE' }),

    // `scope: 'series'` dissolves the whole recurring series; omitted
    // deletes just this one entry — see docs/adr/0011-calendar-events.md.
    deleteEvent: (bandId: string, eventId: string, scope?: 'series') =>
      req<{ ok: true }>(`/bands/${bandId}/events/${eventId}${scope ? `?scope=${scope}` : ''}`, { method: 'DELETE' }),

    deletePoll: (bandId: string, pollId: string) =>
      req<{ ok: true }>(`/bands/${bandId}/polls/${pollId}`, { method: 'DELETE' }),

    closePoll: (bandId: string, pollId: string, input: ClosePollInput) =>
      req<{ ok: true; eventId: string }>(`/bands/${bandId}/polls/${pollId}/close`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    checkBandMembership: (bandId: string) => checkBandMembership(baseUrl, bandId),

    createInvite: (bandId: string, input: CreateInviteInput) =>
      req<Invite>(`/bands/${bandId}/invites`, { method: 'POST', body: JSON.stringify(input) }),

    listInvites: (bandId: string) => req<Invite[]>(`/bands/${bandId}/invites`),

    revokeInvite: (bandId: string, inviteId: string) =>
      req<Invite>(`/bands/${bandId}/invites/${inviteId}/revoke`, { method: 'POST' }),

    redeemInvite: (input: RedeemInviteInput) =>
      req<{ band: Band; role: BandRole }>('/invites/redeem', { method: 'POST', body: JSON.stringify(input) }),

    getMyPrefs: () => req<UserPrefs>('/me/prefs'),

    updateMyPrefs: (input: UpdateUserPrefsInput) =>
      req<UserPrefs>('/me/prefs', { method: 'PATCH', body: JSON.stringify(input) }),

    // Lazily provisioned on first read — see apps/server/src/routes/icsToken.ts.
    getIcsToken: () => req<{ token: string }>('/me/ics-token'),

    regenerateIcsToken: () => req<{ token: string }>('/me/ics-token/regenerate', { method: 'POST' }),

    // Web push — see apps/server/src/routes/push.ts. `publicKey` is `null`
    // when the self-hoster hasn't run `pnpm push:keys` yet.
    getPushPublicKey: () => req<{ publicKey: string | null }>('/push/public-key'),

    subscribePush: (input: SubscribePushInput) =>
      req<{ ok: true }>('/push/subscribe', { method: 'POST', body: JSON.stringify(input) }),

    unsubscribePush: (endpoint: string) =>
      req<{ ok: true }>(`/push/subscribe/${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),

    updatePushPref: (trigger: keyof PushTriggers, enabled: boolean) =>
      req<{ pushTriggers: PushTriggers }>('/push/prefs', {
        method: 'PATCH',
        body: JSON.stringify({ trigger, enabled }),
      }),

    // Content-addressed file upload flow — see docs/adr/0007-content-addressed-files.md.
    // The actual bytes never go through this client: presign-upload/download
    // return a URL the caller PUTs/GETs directly against the object store.
    checkFileExists: (bandId: string, sha256: string) =>
      req<{ exists: boolean }>(`/bands/${bandId}/files/check`, { method: 'POST', body: JSON.stringify({ sha256 }) }),

    presignFileUpload: (bandId: string, input: PresignUploadInput) =>
      req<{ uploadUrl: string }>(`/bands/${bandId}/files/presign-upload`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    confirmFileUpload: (bandId: string, input: ConfirmFileInput) =>
      req<{ ok: true }>(`/bands/${bandId}/files/confirm`, { method: 'POST', body: JSON.stringify(input) }),

    presignFileDownload: (bandId: string, sha256: string) =>
      req<{ downloadUrl: string }>(`/bands/${bandId}/files/${sha256}/presign-download`),

    // Strictly personal voice annotations — see B4 of the Milestone 2 Teil B
    // plan. Never routed through the band's Yjs document.
    listMyAnnotationLayers: (bandId: string, voiceId: string) =>
      req<AnnotationLayerDto[]>(`/bands/${bandId}/annotations/voices/${voiceId}`),

    listSharedAnnotationLayers: (bandId: string, voiceId: string) =>
      req<AnnotationLayerDto[]>(`/bands/${bandId}/annotations/voices/${voiceId}/shared`),

    createAnnotationLayer: (bandId: string, voiceId: string, input: CreateAnnotationLayerInput) =>
      req<AnnotationLayerDto>(`/bands/${bandId}/annotations/voices/${voiceId}`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    updateAnnotationLayer: (bandId: string, layerId: string, input: UpdateAnnotationLayerInput) =>
      req<{ conflict: boolean; layer: AnnotationLayerDto }>(`/bands/${bandId}/annotations/${layerId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),

    deleteAnnotationLayer: (bandId: string, layerId: string) =>
      req<{ ok: true }>(`/bands/${bandId}/annotations/${layerId}`, { method: 'DELETE' }),

    shareAnnotationLayer: (bandId: string, layerId: string) =>
      req<AnnotationLayerDto>(`/bands/${bandId}/annotations/${layerId}/share`, { method: 'POST' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
