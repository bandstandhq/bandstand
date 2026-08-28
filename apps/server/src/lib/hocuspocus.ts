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
import type { CalendarEvent, Poll } from '@bandstand/core';
import {
  bandSnapshotSchema,
  HOCUSPOCUS_AUTH_FAILURE_REASON,
  itemsKey,
  yDocToSnapshot,
} from '@bandstand/core';
import { Database } from '@hocuspocus/extension-database';
import { isTransactionOrigin, Server } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bandDocs, bandMembers } from '../db/schema/index';
import { sendPushToUsers } from '../push/send';
import { auth } from './auth';
import { getBandMembership } from './bandAuthz';
import { isForeignKeyViolation } from './pgErrors';

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

// availability:respond/poll:vote (docs/PERMISSIONS.md, docs/adr/0011-calendar-events.md)
// have no matrix entry at all — every member may write to these maps, but
// only under their own `:<userId>` key, never anyone else's, and there's no
// REST route in front of these live doc edits to check that. This is a
// different kind of guard from GUARDED_MAPS above: it isn't "was a key
// deleted," it's "does every touched key's trailing `:<userId>` segment
// match the actor who touched it" — insert, update, and delete are all
// checked, not just deletion.
const OWNERSHIP_GUARDED_MAPS = ['availability', 'pollVotes'] as const;
type OwnershipGuardedMapName = (typeof OWNERSHIP_GUARDED_MAPS)[number];

function keyOwnerUserId(compositeKey: string): string {
  return compositeKey.slice(compositeKey.lastIndexOf(':') + 1);
}

interface GuardSnapshot {
  maps: Record<GuardedMapName, Record<string, unknown>>;
  // itemsKey(setlistId) -> that setlist's items, only for setlists present
  // in `maps.setlists` at snapshot time.
  items: Record<string, unknown[]>;
  ownershipMaps: Record<OwnershipGuardedMapName, Record<string, unknown>>;
}

// Keyed by bandId (Hocuspocus's documentName). Module-level and
// per-process: fine, since each band's document lives in exactly one
// server process at a time.
const lastKnownGuardSnapshot = new Map<string, GuardSnapshot>();

// --- Push notifications for event/poll creation and changes ---
//
// Unlike song:deleteForever or setlist:delete, an ordinary event/poll
// create/edit is a plain CRDT write with no REST route in front of it (see
// routes/events.ts's own comment) — this onChange hook is the only place
// that ever observes it server-side, so it's also where the corresponding
// push notification (docs/adr/0012-web-push.md) fires from.
interface EventsPollsSnapshot {
  events: Record<string, CalendarEvent>;
  polls: Record<string, Poll>;
}

const lastKnownEventsPollsSnapshot = new Map<string, EventsPollsSnapshot>();

function snapshotEventsPolls(document: {
  getMap: (name: string) => { toJSON(): Record<string, unknown> };
}): EventsPollsSnapshot {
  return {
    events: document.getMap('events').toJSON() as Record<string, CalendarEvent>,
    polls: document.getMap('polls').toJSON() as Record<string, Poll>,
  };
}

/**
 * A new key in `events` whose `seriesId` doesn't already appear on some
 * *other* entry from before this change is a genuinely new event (or a
 * new recurring series' template) — "eventCreated". A new key that shares
 * a `seriesId` with an entry that already existed is a new exception on an
 * already-known series (someone edited one date of a recurring booking),
 * which reads to a user as "eventChanged," not a brand new event.
 */
function isNewException(
  event: CalendarEvent,
  previousEvents: Record<string, CalendarEvent>,
): boolean {
  if (!event.seriesId) return false;
  return Object.values(previousEvents).some((existing) => existing.seriesId === event.seriesId);
}

async function notifyEventsAndPolls(
  bandId: string,
  actingUserId: string | undefined,
  current: EventsPollsSnapshot,
): Promise<void> {
  const previous = lastKnownEventsPollsSnapshot.get(bandId);
  lastKnownEventsPollsSnapshot.set(bandId, current);
  if (!previous) return;

  const created: { id: string; event: CalendarEvent }[] = [];
  const changed: { id: string; event: CalendarEvent }[] = [];
  for (const [eventId, event] of Object.entries(current.events)) {
    const before = previous.events[eventId];
    if (!before) {
      (isNewException(event, previous.events) ? changed : created).push({ id: eventId, event });
    } else if (JSON.stringify(before) !== JSON.stringify(event)) {
      changed.push({ id: eventId, event });
    }
  }

  const pollsCreated = Object.entries(current.polls).filter(([pollId]) => !previous.polls[pollId]);

  if (created.length === 0 && changed.length === 0 && pollsCreated.length === 0) return;

  const members = await db
    .select({ userId: bandMembers.userId })
    .from(bandMembers)
    .where(eq(bandMembers.bandId, bandId));
  const memberIds = members.map((m) => m.userId);

  await Promise.all([
    ...created.map(({ id, event }) =>
      sendPushToUsers(memberIds, actingUserId, 'eventCreated', {
        title: 'New event',
        body: event.title,
        url: `/bands/${bandId}/calendar/${id}`,
      }),
    ),
    ...changed.map(({ id, event }) =>
      sendPushToUsers(memberIds, actingUserId, 'eventChanged', {
        title: event.status === 'cancelled' ? 'Event cancelled' : 'Event changed',
        body: event.title,
        url: `/bands/${bandId}/calendar/${id}`,
      }),
    ),
    ...pollsCreated.map(([pollId, poll]) =>
      sendPushToUsers(memberIds, actingUserId, 'pollCreated', {
        title: 'New scheduling poll',
        body: poll.title,
        url: `/bands/${bandId}/polls/${pollId}`,
      }),
    ),
  ]);
}

function snapshotGuardState(document: {
  getMap: (name: string) => { toJSON(): Record<string, unknown> };
  getArray: (name: string) => { toJSON(): unknown[] };
}): GuardSnapshot {
  const maps = {} as GuardSnapshot['maps'];
  for (const name of GUARDED_MAPS) maps[name] = document.getMap(name).toJSON();

  const items: Record<string, unknown[]> = {};
  for (const setlistId of Object.keys(maps.setlists)) {
    items[itemsKey(setlistId)] = document.getArray(itemsKey(setlistId)).toJSON();
  }

  const ownershipMaps = {} as GuardSnapshot['ownershipMaps'];
  for (const name of OWNERSHIP_GUARDED_MAPS) ownershipMaps[name] = document.getMap(name).toJSON();

  return { maps, items, ownershipMaps };
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
    lastKnownEventsPollsSnapshot.set(documentName, snapshotEventsPolls(document));
  },
  async onChange({ document, documentName, transactionOrigin, context }) {
    const previous = lastKnownGuardSnapshot.get(documentName);
    const current = snapshotGuardState(document);

    const actor = context as { userId?: string; bandRole?: string } | undefined;

    // Best-effort and fire-and-forget — a push-send failure or delay must
    // never slow down or break the actual doc sync/persistence this hook
    // otherwise handles.
    notifyEventsAndPolls(documentName, actor?.userId, snapshotEventsPolls(document)).catch(
      (err) => {
        console.warn('[push] failed to process event/poll change for notifications', {
          bandId: documentName,
          error: err,
        });
      },
    );

    const isRealClientWrite =
      isTransactionOrigin(transactionOrigin) && transactionOrigin.source === 'connection';
    if (previous && isRealClientWrite) {
      const reverted: { mapName: GuardedMapName; key: string }[] = [];
      const revertedOwnership: { mapName: OwnershipGuardedMapName; key: string }[] = [];

      document.transact(
        () => {
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

          // Ownership guard: any availability/pollVotes key this write
          // touched (added, changed, or removed) whose owner segment isn't
          // the acting user's own id gets restored to exactly what it was.
          for (const mapName of OWNERSHIP_GUARDED_MAPS) {
            const before = previous.ownershipMaps[mapName];
            const after = current.ownershipMaps[mapName];
            const touchedKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

            for (const key of touchedKeys) {
              if (before[key] === after[key]) continue;
              if (actor?.userId && keyOwnerUserId(key) === actor.userId) continue;

              if (key in before) document.getMap(mapName).set(key, before[key]);
              else document.getMap(mapName).delete(key);
              revertedOwnership.push({ mapName, key });
            }
          }
        },
        { source: 'local' },
      );

      for (const { mapName, key } of reverted) {
        console.warn('[hocuspocus] reverted an unauthorized deletion attempt', {
          event: 'permission-guard.reverted',
          bandId: documentName,
          mapName,
          key,
          actingUserId: actor?.userId,
          actingRole: actor?.bandRole,
        });
      }

      for (const { mapName, key } of revertedOwnership) {
        console.warn("[hocuspocus] reverted an attempt to write another member's answer", {
          event: 'permission-guard.reverted-ownership',
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
        try {
          await db
            .insert(bandDocs)
            .values({ bandId: documentName, yjsState: state, snapshot, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: bandDocs.bandId,
              set: { yjsState: state, snapshot, updatedAt: new Date() },
            });
        } catch (err) {
          // This debounced store (up to `maxDebounce` below) can still be in
          // flight after the band itself was deleted via DELETE
          // /bands/:bandId — the band row (and this one, via cascade) is
          // already gone by the time this write lands. The deletion is
          // authoritative; a stale write racing behind it is expected, not
          // a real failure, so it's dropped rather than logged as an error.
          if (!isForeignKeyViolation(err)) throw err;
        }
      },
    }),
  ],
  debounce: 2000,
  maxDebounce: 10000,
});
