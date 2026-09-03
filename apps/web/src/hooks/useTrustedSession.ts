// SPDX-License-Identifier: Apache-2.0
import { authClient } from '../lib/auth-client';
import { getCachedSession } from '../lib/sessionCache';

type SessionData = ReturnType<typeof authClient.useSession>['data'];

/**
 * `authClient.useSession()`, with the same offline fallback RequireAuth.tsx
 * applies at the route level (see its own doc comment) — a cached, locally
 * confirmed session substituted in when the live check errors out (offline,
 * unreachable server) rather than confirming anonymity. Every consumer that
 * derives functionality (not just display) from `session.user.id` or
 * `session.session.token` needs this, not just the route guard: without it,
 * a device that's offline sees a real `data: null` from the hook below and
 * silently disables itself — this was the actual cause of useBandDoc.ts
 * refusing to even open a band's locally cached Yjs doc while offline,
 * despite RequireAuth already having let the user in.
 *
 * `freshData` is the untouched result of the live check — RequireAuth uses
 * it to decide what's actually worth caching, so a fallback value read back
 * out of the cache never gets written straight back into it.
 */
export function useTrustedSession() {
  const result = authClient.useSession();
  const fallback = result.error ? getCachedSession<NonNullable<SessionData>>() : null;
  return { ...result, data: result.data ?? fallback, freshData: result.data };
}
