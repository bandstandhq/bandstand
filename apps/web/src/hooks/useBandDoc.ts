// SPDX-License-Identifier: Apache-2.0
import { HOCUSPOCUS_AUTH_FAILURE_REASON } from '@bandstand/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { apiClient } from '../lib/api-client';
import { connectBandDoc } from '../lib/yjs';
import { useTrustedSession } from './useTrustedSession';

export type BandDocStatus = 'connecting' | 'connected' | 'offline' | 'forbidden';

export interface UseBandDocResult {
  doc: Y.Doc | null;
  provider: HocuspocusProvider | null;
  status: BandDocStatus;
}

function membershipStorageKey(userId: string, bandId: string): string {
  return `bandstand:membership:${userId}:${bandId}`;
}

/** Best-effort — a device that's never been offline yet correctly has no record. */
function readLastKnownMembership(userId: string, bandId: string): boolean {
  try {
    return localStorage.getItem(membershipStorageKey(userId, bandId)) === 'true';
  } catch {
    return false;
  }
}

function writeLastKnownMembership(userId: string, bandId: string, isMember: boolean): void {
  try {
    if (isMember) localStorage.setItem(membershipStorageKey(userId, bandId), 'true');
    else localStorage.removeItem(membershipStorageKey(userId, bandId));
  } catch {
    // Safari private mode etc. can throw on localStorage access — not fatal,
    // it just means the offline fallback below won't have a record.
  }
}

/**
 * Opens (and tears down on unmount/bandId change) the Yjs connection for
 * one band — gated on membership, not just authentication. See
 * docs/adr/0006-offline-cache-scoping.md: a locally cached band doc is only
 * ever exposed to callers once this device's current user is confirmed (or,
 * offline, was last confirmed) to still be a member.
 */
export function useBandDoc(bandId: string | null): UseBandDocResult {
  // useTrustedSession, not the raw hook: offline, the real session check
  // resolves to `data: null` same as a genuine logged-out response, and
  // this effect would never even call connectBandDoc — the locally cached
  // Yjs doc (this whole hook's reason to exist) never opens, despite
  // RequireAuth already having let the user past the route guard on the
  // strength of the very same cached session.
  const { data: session, refetch: refetchSession } = useTrustedSession();
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<BandDocStatus>('connecting');

  useEffect(() => {
    const token = session?.session.token;
    const userId = session?.user.id;
    if (!bandId || !token || !userId) return undefined;
    // Narrowed, stable bindings for the deferred closures below (event
    // handlers, a .then() callback) — the guard above doesn't stay narrowed
    // inside those once TypeScript sees them as stored-for-later.
    const activeBandId = bandId;
    const activeUserId = userId;

    let cancelled = false;
    let forbidden = false;
    // Resetting to the initial state for a new bandId/session — not a
    // redundant re-derivation of state React already has.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('connecting');
    setDoc(null);
    setProvider(null);

    const connection = connectBandDoc(activeUserId, activeBandId, token);

    function reveal() {
      if (cancelled || forbidden) return;
      setDoc(connection.doc);
      setProvider(connection.provider);
    }

    function deny() {
      if (cancelled) return;
      forbidden = true;
      writeLastKnownMembership(activeUserId, activeBandId, false);
      connection.indexeddb.clearData().catch(() => {});
      connection.provider.destroy();
      setDoc(null);
      setProvider(null);
      setStatus('forbidden');
    }

    connection.provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      if (reason === HOCUSPOCUS_AUTH_FAILURE_REASON.notAMember) {
        deny();
        return;
      }
      // Any other reason (e.g. an expired/invalid token) — refresh the
      // session rather than silently staying offline forever. If the
      // refreshed token differs from the one this effect closed over, the
      // dependency array below re-runs the whole effect and reconnects
      // with it; if it's unchanged (session genuinely expired/revoked),
      // there's nothing left to retry and the provider's own close handler
      // marks this offline, same as any other disconnect.
      if (cancelled || forbidden) return;
      refetchSession();
    });
    connection.provider.on('synced', () => {
      if (cancelled || forbidden) return;
      writeLastKnownMembership(activeUserId, activeBandId, true);
      setStatus('connected');
      reveal();
    });
    connection.provider.on('close', () => {
      // A close triggered by deny()'s own provider.destroy() must not
      // overwrite the 'forbidden' status it just set.
      if (cancelled || forbidden) return;
      setStatus('offline');
    });

    apiClient.checkBandMembership(bandId).then((result) => {
      if (cancelled || forbidden) return;
      if (result === 'member') {
        writeLastKnownMembership(activeUserId, activeBandId, true);
        reveal();
      } else if (result === 'not-member') {
        deny();
      } else if (readLastKnownMembership(activeUserId, activeBandId)) {
        // Inconclusive (offline, timeout, 5xx): trust the last confirmed
        // membership rather than blocking a device that's legitimately
        // offline mid-show — see docs/adr/0006-offline-cache-scoping.md.
        reveal();
      }
    });

    return () => {
      cancelled = true;
      connection.provider.destroy();
      connection.indexeddb.destroy();
    };
  }, [bandId, session?.session.token, session?.user.id, refetchSession]);

  return { doc, provider, status };
}
