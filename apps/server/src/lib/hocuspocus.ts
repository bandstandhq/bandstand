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
import type { BandRole, CalendarEvent, Poll } from '@bandstand/core';
import {
  anchorsKey,
  bandSnapshotSchema,
  hasAtLeastRole,
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

// event:create/event:edit/poll:create (docs/PERMISSIONS.md) are admin-only
// in the permissions matrix, but — same root cause as availability/pollVotes
// above — creating/editing an event or poll is itself a plain CRDT write
// with no REST route in front of it. Unlike availability/pollVotes, there's
// no self-scope here at all: any touched key a non-admin actor didn't have
// the role for gets reverted, added or changed or deleted alike. See
// docs/adr/0013-crdt-role-enforcement.md.
const ROLE_GUARDED_MAPS = ['events', 'polls'] as const;
type RoleGuardedMapName = (typeof ROLE_GUARDED_MAPS)[number];

// assignment:editOthers (docs/PERMISSIONS.md) is admin-only, but a member
// changing *their own* assignment is always allowed at any role (matrix.ts's
// own comment: "a member changing their own voice assignment is always
// allowed, at any role"). This is the one guarded map where both an
// ownership exception and a role exception apply — a touched key is left
// alone if the actor is either its own owner or an admin.
const SELF_OR_ADMIN_GUARDED_MAPS = ['assignments'] as const;
type SelfOrAdminGuardedMapName = (typeof SELF_OR_ADMIN_GUARDED_MAPS)[number];

interface GuardSnapshot {
  maps: Record<GuardedMapName, Record<string, unknown>>;
  // itemsKey(setlistId) -> that setlist's items, only for setlists present
  // in `maps.setlists` at snapshot time.
  items: Record<string, unknown[]>;
  ownershipMaps: Record<OwnershipGuardedMapName, Record<string, unknown>>;
  roleGuardedMaps: Record<RoleGuardedMapName, Record<string, unknown>>;
  // anchorsKey(songId) -> that song's band-wide anchor list, only for songs
  // present in `maps.songs` at snapshot time — same "only where the parent
  // key already exists" shape as `items` above.
  anchorArrays: Record<string, unknown[]>;
  selfOrAdminMaps: Record<SelfOrAdminGuardedMapName, Record<string, unknown>>;
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

  const anchorArrays: Record<string, unknown[]> = {};
  for (const songId of Object.keys(maps.songs)) {
    anchorArrays[anchorsKey(songId)] = document.getArray(anchorsKey(songId)).toJSON();
  }

  const ownershipMaps = {} as GuardSnapshot['ownershipMaps'];
  for (const name of OWNERSHIP_GUARDED_MAPS) ownershipMaps[name] = document.getMap(name).toJSON();

  const roleGuardedMaps = {} as GuardSnapshot['roleGuardedMaps'];
  for (const name of ROLE_GUARDED_MAPS) roleGuardedMaps[name] = document.getMap(name).toJSON();

  const selfOrAdminMaps = {} as GuardSnapshot['selfOrAdminMaps'];
  for (const name of SELF_OR_ADMIN_GUARDED_MAPS) selfOrAdminMaps[name] = document.getMap(name).toJSON();

  return { maps, items, ownershipMaps, roleGuardedMaps, anchorArrays, selfOrAdminMaps };
}

/**
 * `===` is correct for OWNERSHIP_GUARDED_MAPS's own touched-key check
 * because availability/pollVotes store plain strings — but `events`/
 * `polls`/`assignments`/anchor arrays store objects/arrays, and
 * `Y.Map.toJSON()`/`Y.Array.toJSON()` build a fresh plain value on every
 * call, so two structurally-identical snapshots are never `===`. Content
 * comparison is the only correct check for those.
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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

// A coarse transport-level backstop, not a substitute for the per-field
// zod caps in packages/core/src/schemas/ — those only run inside the
// debounced Postgres store hook below, *after* a CRDT update has already
// been applied to the in-memory doc and broadcast to every connected
// client. A single WebSocket message this large would already mean
// something is badly wrong (a full-document sync for a genuinely large band
// still fits comfortably under this), so rejecting it outright at the
// connection level is strictly better than letting it reach the doc at all.
const MAX_HOCUSPOCUS_MESSAGE_BYTES = 20 * 1024 * 1024;

export const hocuspocusServer = new Server({
  port: Number(process.env.HOCUSPOCUS_PORT ?? 3002),
  websocketOptions: { maxPayload: MAX_HOCUSPOCUS_MESSAGE_BYTES },
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

    const actor = context as { userId?: string; bandRole?: BandRole } | undefined;
    const actorIsAdmin = Boolean(actor?.bandRole && hasAtLeastRole(actor.bandRole, 'admin'));

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
      const revertedRole: { mapName: RoleGuardedMapName; key: string }[] = [];
      const revertedAnchors: { arrayKey: string }[] = [];
      const revertedSelfOrAdmin: { mapName: SelfOrAdminGuardedMapName; key: string }[] = [];

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

          // Role guard: creating/editing/deleting an event or poll is
          // admin-only (docs/PERMISSIONS.md) — any touched key from a
          // non-admin actor is restored, no self-scope exception exists here.
          if (!actorIsAdmin) {
            for (const mapName of ROLE_GUARDED_MAPS) {
              const before = previous.roleGuardedMaps[mapName];
              const after = current.roleGuardedMaps[mapName];
              const touchedKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

              for (const key of touchedKeys) {
                if (deepEqualJson(before[key], after[key])) continue;

                if (key in before) document.getMap(mapName).set(key, before[key]);
                else document.getMap(mapName).delete(key);
                revertedRole.push({ mapName, key });
              }
            }

            // Anchors are band-wide, not self-scoped (matrix.ts's own
            // comment) — any change to a song's anchor array from a
            // non-admin actor is reverted wholesale, same whole-array
            // rewrite `reorderAnchors` itself already uses.
            const touchedArrayKeys = new Set([
              ...Object.keys(previous.anchorArrays),
              ...Object.keys(current.anchorArrays),
            ]);
            for (const arrayKey of touchedArrayKeys) {
              const before = previous.anchorArrays[arrayKey] ?? [];
              const after = current.anchorArrays[arrayKey] ?? [];
              if (deepEqualJson(before, after)) continue;

              const array = document.getArray(arrayKey);
              if (array.length > 0) array.delete(0, array.length);
              array.push(before);
              revertedAnchors.push({ arrayKey });
            }
          }

          // Self-or-admin guard: a member may always change their own voice
          // assignment; overriding someone else's needs admin
          // (assignment:editOthers, docs/PERMISSIONS.md).
          for (const mapName of SELF_OR_ADMIN_GUARDED_MAPS) {
            const before = previous.selfOrAdminMaps[mapName];
            const after = current.selfOrAdminMaps[mapName];
            const touchedKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

            for (const key of touchedKeys) {
              if (deepEqualJson(before[key], after[key])) continue;
              if (actor?.userId && keyOwnerUserId(key) === actor.userId) continue;
              if (actorIsAdmin) continue;

              if (key in before) document.getMap(mapName).set(key, before[key]);
              else document.getMap(mapName).delete(key);
              revertedSelfOrAdmin.push({ mapName, key });
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

      for (const { mapName, key } of revertedRole) {
        console.warn('[hocuspocus] reverted a non-admin write to an admin-only map', {
          event: 'permission-guard.reverted-role',
          bandId: documentName,
          mapName,
          key,
          actingUserId: actor?.userId,
          actingRole: actor?.bandRole,
        });
      }

      for (const { arrayKey } of revertedAnchors) {
        console.warn('[hocuspocus] reverted a non-admin edit to a band-wide anchor list', {
          event: 'permission-guard.reverted-role',
          bandId: documentName,
          arrayKey,
          actingUserId: actor?.userId,
          actingRole: actor?.bandRole,
        });
      }

      for (const { mapName, key } of revertedSelfOrAdmin) {
        console.warn("[hocuspocus] reverted an attempt to override another member's assignment", {
          event: 'permission-guard.reverted-self-or-admin',
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
