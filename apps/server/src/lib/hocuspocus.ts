// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hocuspocus runs as its own WebSocket server on HOCUSPOCUS_PORT, separate
// from the Hono HTTP API — mounting a raw WebSocket upgrade onto Hono's
// (Node-only) HTTP server would need extra glue Hocuspocus's own .listen()
// already provides. `documentName` is the bandId; band_docs.band_id is the
// persistence key for the Database extension below.
//
// onAuthenticate verifies the better-auth session/JWT via the bearer
// plugin, then checks that the authenticated user is actually a member of
// the requested band (documentName === bandId) — closes
// https://github.com/bandstandhq/bandstand/issues/1.
import { bandSnapshotSchema, HOCUSPOCUS_AUTH_FAILURE_REASON, itemsKey, yDocToSnapshot } from '@bandstand/core';
import { Database } from '@hocuspocus/extension-database';
import { isTransactionOrigin, Server } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bandDocs } from '../db/schema/index';
import { auth } from './auth';
import { getBandMembership } from './bandAuthz';

// --- Manipulated-client guard against destructive Yjs-doc writes ---
//
// song:deleteForever and setlist:delete (docs/adr/0005-permissions.md) are
// only ever meant to happen server-side, via bandDoc.ts's withBandDoc, which
// tags its writes with Hocuspocus's `{ source: 'local' }` transaction
// origin. A real client's own write is always tagged `{ source:
// 'connection' }` — regardless of that connection's role, since even an
// owner/admin's client is supposed to go through REST for these, not CRDT.
// If a client-originated change removes a key from `songs`, `voices`, or
// `setlists` that existed a moment ago (or clears a setlist's items array
// together with its own map entry — the two operations deleteSetlist always
// performs together), that's exactly the bypass this guard exists to catch:
// the entry is restored immediately, and the attempt is logged with who did
// it and what they tried to delete. A client doing this is either buggy or
// malicious, and either way that must be visible, not silently corrected.
// Follow-up: https://github.com/bandstandhq/bandstand/issues/48 tracks
// surfacing this as a visible admin-facing warning in the band UI.
const GUARDED_MAPS = ['songs', 'voices', 'setlists'] as const;
type GuardedMapName = (typeof GUARDED_MAPS)[number];

interface GuardSnapshot {
  maps: Record<GuardedMapName, Record<string, unknown>>;
  // itemsKey(setlistId) -> that setlist's items, only for setlists present
  // in `maps.setlists` at snapshot time.
  items: Record<string, unknown[]>;
}

// Keyed by bandId (Hocuspocus's documentName). Module-level and
// per-process: fine, since each band's document lives in exactly one
// server process at a time.
const lastKnownGuardSnapshot = new Map<string, GuardSnapshot>();

function snapshotGuardState(document: { getMap: (name: string) => { toJSON(): Record<string, unknown> }; getArray: (name: string) => { toJSON(): unknown[] } }): GuardSnapshot {
  const maps = {} as GuardSnapshot['maps'];
  for (const name of GUARDED_MAPS) maps[name] = document.getMap(name).toJSON();

  const items: Record<string, unknown[]> = {};
  for (const setlistId of Object.keys(maps.setlists)) {
    items[itemsKey(setlistId)] = document.getArray(itemsKey(setlistId)).toJSON();
  }

  return { maps, items };
}

// @hocuspocus/server reads a thrown error's `.reason` and sends it to the
// client as an explicit, application-level "permission-denied" message
// (not a WebSocket close code) — see the client-side handler in
// apps/web/src/lib/yjs.ts for why that distinction matters.
class HocuspocusAuthError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

export const hocuspocusServer = new Server({
  port: Number(process.env.HOCUSPOCUS_PORT ?? 3002),
  async onAuthenticate({ token, documentName }) {
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });

    if (!session) {
      throw new HocuspocusAuthError(HOCUSPOCUS_AUTH_FAILURE_REASON.unauthorized, 'Unauthorized');
    }

    const membership = await getBandMembership(documentName, session.user.id);
    if (!membership) {
      throw new HocuspocusAuthError(
        HOCUSPOCUS_AUTH_FAILURE_REASON.notAMember,
        'Forbidden: not a member of this band',
      );
    }

    return { userId: session.user.id, bandId: documentName, bandRole: membership.role };
  },
  // Hocuspocus only starts calling onChange for a document *after* its
  // persisted state has already been loaded (loadDocument applies the fetch
  // result, then registers the update listener that feeds onChange) — the
  // load itself never fires onChange. Without this hook, the guard below
  // would have no baseline snapshot until the first real onChange call,
  // meaning the very first write to a freshly loaded document (including a
  // malicious one, right after a server restart or the first reconnect to
  // an unloaded band) would slip through undetected.
  async afterLoadDocument({ document, documentName }) {
    lastKnownGuardSnapshot.set(documentName, snapshotGuardState(document));
  },
  async onChange({ document, documentName, transactionOrigin, context }) {
    const previous = lastKnownGuardSnapshot.get(documentName);
    const current = snapshotGuardState(document);

    const isRealClientWrite = isTransactionOrigin(transactionOrigin) && transactionOrigin.source === 'connection';
    if (previous && isRealClientWrite) {
      const reverted: { mapName: GuardedMapName; key: string }[] = [];

      document.transact(() => {
        for (const mapName of GUARDED_MAPS) {
          for (const [key, value] of Object.entries(previous.maps[mapName])) {
            if (!(key in current.maps[mapName])) {
              document.getMap(mapName).set(key, value);
              reverted.push({ mapName, key });
            }
          }
        }
        for (const [arrayKey, items] of Object.entries(previous.items)) {
          if (current.items[arrayKey] === undefined) {
            document.getArray(arrayKey).push(items);
          }
        }
      }, { source: 'local' });

      for (const { mapName, key } of reverted) {
        const actor = context as { userId?: string; bandRole?: string } | undefined;
        console.warn('[hocuspocus] reverted an unauthorized deletion attempt', {
          event: 'permission-guard.reverted',
          bandId: documentName,
          mapName,
          key,
          actingUserId: actor?.userId,
          actingRole: actor?.bandRole,
        });
      }
    }

    // Re-read rather than reuse `current`: if a revert just ran above, the
    // document has already moved past what `current` captured, and the
    // nested onChange that revert's own transact triggers (tagged 'local',
    // so it won't recurse into another revert) already stores this same
    // snapshot — this call is a harmless, idempotent re-store, not a race.
    lastKnownGuardSnapshot.set(documentName, snapshotGuardState(document));
  },
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const [row] = await db
          .select({ yjsState: bandDocs.yjsState })
          .from(bandDocs)
          .where(eq(bandDocs.bandId, documentName));
        return row?.yjsState ?? null;
      },
      store: async ({ documentName, state, document }) => {
        const snapshot = bandSnapshotSchema.parse(yDocToSnapshot(document));
        await db
          .insert(bandDocs)
          .values({ bandId: documentName, yjsState: state, snapshot, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: bandDocs.bandId,
            set: { yjsState: state, snapshot, updatedAt: new Date() },
          });
      },
    }),
  ],
  debounce: 2000,
  maxDebounce: 10000,
});
