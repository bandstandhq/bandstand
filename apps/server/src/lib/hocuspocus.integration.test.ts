// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres and a real WebSocket round-trip — the whole point
// is proving a non-member's connection is genuinely rejected by the real
// Hocuspocus server, not just that getBandMembership() returns null in
// isolation. Closes https://github.com/bandstandhq/bandstand/issues/1.
import { randomUUID } from 'node:crypto';
import { anchorsKey, getDefaultVoiceId, HOCUSPOCUS_AUTH_FAILURE_REASON, yDocToSnapshot } from '@bandstand/core';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import {
  bandDocs,
  bandMembers,
  bands,
  pushSubscriptions,
  userPrefs,
  users,
} from '../db/schema/index';
import type { PushSender } from '../push/send';
import { setPushSenderForTesting } from '../push/send';
import { auth } from './auth';
import { hocuspocusServer } from './hocuspocus';

async function signUpTestUser() {
  const email = `test-hocuspocus-auth-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'HP Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

type ConnectResult = { status: 'connected' } | { status: 'rejected'; reason: string };

function attemptConnect(port: number, bandId: string, token: string): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const config: ConstructorParameters<typeof HocuspocusProvider>[0] & {
      WebSocketPolyfill?: unknown;
    } = {
      url: `ws://localhost:${port}`,
      name: bandId,
      document: new Y.Doc(),
      token,
      onAuthenticationFailed: ({ reason }) => {
        provider.destroy();
        resolve({ status: 'rejected', reason });
      },
      onSynced: () => {
        provider.destroy();
        resolve({ status: 'connected' });
      },
    };
    // `HocuspocusProvider`'s type doesn't declare `WebSocketPolyfill` for the
    // plain-`url` constructor form (only `HocuspocusProviderWebsocket`'s
    // config type does) — but at runtime, giving it a `url` makes it
    // construct its own internal HocuspocusProviderWebsocket from this same
    // object, so the field is still forwarded and honored. Node has no
    // native WebSocket global for the library's default to fall back on,
    // hence needing `ws` here at all.
    config.WebSocketPolyfill = WebSocket;
    const provider = new HocuspocusProvider(config);
  });
}

/**
 * Hocuspocus debounces its Postgres store (see hocuspocus.ts's `debounce`),
 * so a write that has already been applied and broadcast in memory reaches
 * band_docs a beat later — polling for it is the honest way to assert
 * persistence, rather than reading once and racing the debounce.
 */
async function waitForSnapshot(
  bandId: string,
  predicate: (snapshot: NonNullable<Awaited<ReturnType<typeof readSnapshot>>>) => boolean,
  timeoutMs = 8000,
) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await readSnapshot(bandId);
  while (Date.now() < deadline) {
    if (snapshot && predicate(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, 200));
    snapshot = await readSnapshot(bandId);
  }
  return snapshot;
}

async function readSnapshot(bandId: string) {
  const [row] = await db
    .select({ snapshot: bandDocs.snapshot })
    .from(bandDocs)
    .where(eq(bandDocs.bandId, bandId));
  return row?.snapshot;
}

function connectSynced(port: number, bandId: string, token: string): Promise<HocuspocusProvider> {
  return new Promise((resolve) => {
    const config: ConstructorParameters<typeof HocuspocusProvider>[0] & {
      WebSocketPolyfill?: unknown;
    } = {
      url: `ws://localhost:${port}`,
      name: bandId,
      document: new Y.Doc(),
      token,
      onSynced: () => resolve(provider),
    };
    config.WebSocketPolyfill = WebSocket;
    const provider = new HocuspocusProvider(config);
  });
}

describe('Hocuspocus onAuthenticate (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];
  let extraProvider: HocuspocusProvider | undefined;

  const originalVapidPublic = process.env.VAPID_PUBLIC_KEY;
  const originalVapidPrivate = process.env.VAPID_PRIVATE_KEY;

  beforeAll(async () => {
    await hocuspocusServer.listen();
  });

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  afterEach(() => {
    if (originalVapidPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = originalVapidPublic;
    if (originalVapidPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = originalVapidPrivate;
  });

  afterAll(async () => {
    extraProvider?.destroy();
    await hocuspocusServer.destroy();
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('accepts a real band member and rejects a non-member, over a real WebSocket', async () => {
    const member = await signUpTestUser();
    const outsider = await signUpTestUser();
    cleanupUserIds.push(member.userId, outsider.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'HP Auth Test Band', slug: `test-hp-auth-test-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId: member.userId, role: 'member', instruments: [] });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    const [memberResult, outsiderResult] = await Promise.all([
      attemptConnect(port, band.id, member.token),
      attemptConnect(port, band.id, outsider.token),
    ]);

    expect(memberResult).toEqual({ status: 'connected' });
    expect(outsiderResult).toEqual({
      status: 'rejected',
      reason: HOCUSPOCUS_AUTH_FAILURE_REASON.notAMember,
    });
  }, 15000);

  // song:deleteForever is only meant to happen via that REST endpoint
  // (docs/adr/0005-permissions.md), which applies the change through
  // bandDoc.ts's withBandDoc — never through a client's own CRDT write. This
  // proves the manipulated-client guard in hocuspocus.ts's onChange actually
  // catches the bypass: a real member connection deletes the song directly
  // over a live sync, with no REST call involved, and the server reverts it
  // and broadcasts the restored entry back.
  it("reverts a member's direct CRDT deletion of a song and restores it on the server too", async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Guard Test Band', slug: `test-guard-test-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId: member.userId, role: 'member', instruments: [] });

    const songId = `song-${randomUUID()}`;
    const seedDoc = new Y.Doc();
    seedDoc.getMap('songs').set(songId, {
      title: 'Guarded Song',
      artist: '',
      key: 'C',
      bpm: 120,
      durationSec: 180,
      status: 'active',
      bandNotes: '',
      links: [],
      votes: {},
    });
    seedDoc
      .getMap('voices')
      .set(getDefaultVoiceId(songId), { songId, name: 'Default', body: '{title: Guarded Song}' });
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, member.token);

    const songsMap = extraProvider.document.getMap('songs');
    expect(songsMap.has(songId)).toBe(true);

    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Song was not restored in time')), 8000);
      const onMapChange = () => {
        if (songsMap.has(songId)) {
          clearTimeout(timeout);
          songsMap.unobserve(onMapChange);
          resolve();
        }
      };
      songsMap.observe(onMapChange);
    });

    // The attack: delete the song directly over the live CRDT connection —
    // no REST call, exactly the bypass the guard exists to catch.
    songsMap.delete(songId);

    await restored;
    expect(songsMap.get(songId)).toMatchObject({ title: 'Guarded Song' });

    // The revert must actually have persisted server-side too, not just
    // been re-broadcast to this one connection.
    const [row] = await db
      .select({ snapshot: bandDocs.snapshot })
      .from(bandDocs)
      .where(eq(bandDocs.bandId, band.id));
    expect(row?.snapshot?.songs[songId]).toMatchObject({ title: 'Guarded Song' });
  }, 15000);

  // availability:respond/poll:vote are open to every member with no REST
  // route in front of them — the only thing stopping a manipulated client
  // from writing *someone else's* answer is the ownership half of the
  // onChange guard. This proves it: one member, over a real live
  // connection, writes both their own key (must stick) and another
  // member's (must be reverted), in the same transaction.
  it("reverts a member's attempt to write another member's availability answer, keeping their own", async () => {
    const attacker = await signUpTestUser();
    const victim = await signUpTestUser();
    cleanupUserIds.push(attacker.userId, victim.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Ownership Guard Band', slug: `test-ownership-guard-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      { bandId: band.id, userId: attacker.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: victim.userId, role: 'member', instruments: [] },
    ]);

    const eventId = `event-${randomUUID()}`;
    const seedDoc = new Y.Doc();
    seedDoc.getMap('events').set(eventId, {
      type: 'rehearsal',
      title: 'Guarded Rehearsal',
      startsAt: Date.parse('2026-01-05T18:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    });
    seedDoc.getMap('availability').set(`${eventId}:${victim.userId}`, 'yes');
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, attacker.token);

    const availability = extraProvider.document.getMap('availability');
    const victimKey = `${eventId}:${victim.userId}`;
    const ownKey = `${eventId}:${attacker.userId}`;
    expect(availability.get(victimKey)).toBe('yes');

    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Victim's answer was not restored in time")),
        8000,
      );
      const onMapChange = () => {
        if (availability.get(victimKey) === 'yes') {
          clearTimeout(timeout);
          availability.unobserve(onMapChange);
          resolve();
        }
      };
      availability.observe(onMapChange);
    });

    // The attack: overwrite the victim's answer, and set the attacker's own
    // — the guard must undo exactly the first and leave the second alone.
    extraProvider.document.transact(() => {
      availability.set(victimKey, 'no');
      availability.set(ownKey, 'maybe');
    });

    await restored;
    expect(availability.get(victimKey)).toBe('yes');
    expect(availability.get(ownKey)).toBe('maybe');

    // Both halves must have persisted, not just been re-broadcast: the
    // victim's answer as it was, and the attacker's own as they set it.
    const snapshot = await waitForSnapshot(band.id, (s) => s.availability[ownKey] !== undefined);
    expect(snapshot?.availability[victimKey]).toBe('yes');
    expect(snapshot?.availability[ownKey]).toBe('maybe');
  }, 15000);

  it("reverts a member's attempt to delete another member's poll vote", async () => {
    const attacker = await signUpTestUser();
    const victim = await signUpTestUser();
    cleanupUserIds.push(attacker.userId, victim.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Vote Guard Band', slug: `test-vote-guard-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      { bandId: band.id, userId: attacker.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: victim.userId, role: 'member', instruments: [] },
    ]);

    const pollId = `poll-${randomUUID()}`;
    const optionId = `option-${randomUUID()}`;
    const seedDoc = new Y.Doc();
    seedDoc.getMap('polls').set(pollId, {
      title: 'When works?',
      options: [{ id: optionId, startsAt: Date.parse('2026-03-01T19:00:00.000Z') }],
    });
    seedDoc.getMap('pollVotes').set(`${pollId}:${optionId}:${victim.userId}`, 'yes');
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, attacker.token);

    const votes = extraProvider.document.getMap('pollVotes');
    const victimKey = `${pollId}:${optionId}:${victim.userId}`;

    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Victim's vote was not restored in time")),
        8000,
      );
      const onMapChange = () => {
        if (votes.get(victimKey) === 'yes') {
          clearTimeout(timeout);
          votes.unobserve(onMapChange);
          resolve();
        }
      };
      votes.observe(onMapChange);
    });

    votes.delete(victimKey);

    await restored;
    expect(votes.get(victimKey)).toBe('yes');

    const snapshot = await waitForSnapshot(band.id, (s) => s.pollVotes[victimKey] !== undefined);
    expect(snapshot?.pollVotes[victimKey]).toBe('yes');
  }, 15000);

  // event:create/event:edit (docs/PERMISSIONS.md) are admin-only, but — same
  // gap as availability/pollVotes — there's no REST route in front of an
  // ordinary CRDT event write to check that against. This proves the role
  // guard added in docs/adr/0013-crdt-role-enforcement.md actually enforces
  // it: a plain member's direct write is reverted, an admin's equivalent
  // write is left standing.
  it("reverts a member's direct CRDT creation of a calendar event, but lets an admin's stand", async () => {
    const member = await signUpTestUser();
    const admin = await signUpTestUser();
    cleanupUserIds.push(member.userId, admin.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Role Guard Band', slug: `test-role-guard-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: admin.userId, role: 'admin', instruments: [] },
    ]);

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');

    const memberProvider = await connectSynced(port, band.id, member.token);
    const memberEventId = `event-${randomUUID()}`;
    const memberEvents = memberProvider.document.getMap('events');

    const memberReverted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Event was not reverted in time')), 8000);
      const onMapChange = () => {
        if (!memberEvents.has(memberEventId)) {
          clearTimeout(timeout);
          memberEvents.unobserve(onMapChange);
          resolve();
        }
      };
      memberEvents.observe(onMapChange);
    });

    // The attack: a plain member creates an event directly over CRDT.
    memberEvents.set(memberEventId, {
      type: 'rehearsal',
      title: 'Unauthorized Rehearsal',
      startsAt: Date.parse('2026-04-01T18:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    });

    await memberReverted;
    expect(memberEvents.has(memberEventId)).toBe(false);
    memberProvider.destroy();

    const adminProvider = await connectSynced(port, band.id, admin.token);
    const adminEventId = `event-${randomUUID()}`;
    adminProvider.document.getMap('events').set(adminEventId, {
      type: 'rehearsal',
      title: 'Authorized Rehearsal',
      startsAt: Date.parse('2026-04-02T18:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    });

    const snapshot = await waitForSnapshot(band.id, (s) => s.events[adminEventId] !== undefined);
    expect(snapshot?.events[adminEventId]).toMatchObject({ title: 'Authorized Rehearsal' });
    expect(snapshot?.events[memberEventId]).toBeUndefined();
    adminProvider.destroy();
  }, 15000);

  // anchor:edit (docs/PERMISSIONS.md) is admin-only and band-wide, not
  // self-scoped — this proves a plain member's direct edit to a song's
  // anchor array is reverted wholesale, same technique as the other guard
  // tests: a real member connection, no REST call involved.
  it("reverts a non-admin member's direct edit to a song's band-wide anchor list", async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Anchor Guard Band', slug: `test-anchor-guard-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId: member.userId, role: 'member', instruments: [] });

    const songId = `song-${randomUUID()}`;
    const originalAnchor = { id: `anchor-${randomUUID()}`, order: 0, label: 'Verse 1' };
    const seedDoc = new Y.Doc();
    seedDoc.getMap('songs').set(songId, {
      title: 'Anchored Song',
      artist: '',
      key: 'C',
      bpm: 120,
      durationSec: 180,
      status: 'active',
      bandNotes: '',
      links: [],
      votes: {},
    });
    seedDoc.getArray(anchorsKey(songId)).push([originalAnchor]);
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, member.token);

    const anchors = extraProvider.document.getArray(anchorsKey(songId));
    expect(anchors.toJSON()).toEqual([originalAnchor]);

    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Anchor list was not restored in time')), 8000);
      const onArrayChange = () => {
        const current = anchors.toJSON() as { label: string }[];
        if (current.length === 1 && current[0]?.label === 'Verse 1') {
          clearTimeout(timeout);
          anchors.unobserve(onArrayChange);
          resolve();
        }
      };
      anchors.observe(onArrayChange);
    });

    // The attack: a plain member edits the band-wide anchor list directly.
    extraProvider.document.transact(() => {
      anchors.delete(0, 1);
      anchors.push([{ id: `anchor-${randomUUID()}`, order: 0, label: 'Injected' }]);
    });

    await restored;
    expect(anchors.toJSON()).toEqual([originalAnchor]);

    const snapshot = await waitForSnapshot(band.id, (s) => s.anchors[songId] !== undefined);
    expect(snapshot?.anchors[songId]).toEqual([originalAnchor]);
  }, 15000);

  // assignment:editOthers (docs/PERMISSIONS.md) is admin-only, but a member
  // changing their *own* assignment is always allowed at any role — this
  // proves both halves at once: the attacker's own key must stick, the
  // victim's key must be reverted, over a real live connection.
  it("lets a member set their own voice assignment but reverts an attempt to override another member's", async () => {
    const attacker = await signUpTestUser();
    const victim = await signUpTestUser();
    cleanupUserIds.push(attacker.userId, victim.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Assignment Guard Band', slug: `test-assignment-guard-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      { bandId: band.id, userId: attacker.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: victim.userId, role: 'member', instruments: [] },
    ]);

    const songId = `song-${randomUUID()}`;
    const victimKey = `${songId}:${victim.userId}`;
    const attackerKey = `${songId}:${attacker.userId}`;
    const seedDoc = new Y.Doc();
    seedDoc.getMap('assignments').set(victimKey, 'voice-original');
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, attacker.token);

    const assignments = extraProvider.document.getMap('assignments');

    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Victim's assignment was not restored in time")),
        8000,
      );
      const onMapChange = () => {
        if (assignments.get(victimKey) === 'voice-original') {
          clearTimeout(timeout);
          assignments.unobserve(onMapChange);
          resolve();
        }
      };
      assignments.observe(onMapChange);
    });

    // The attack: overwrite the victim's assignment, and set the attacker's
    // own — the guard must undo exactly the first and leave the second alone.
    extraProvider.document.transact(() => {
      assignments.set(victimKey, 'voice-hijacked');
      assignments.set(attackerKey, 'voice-own-choice');
    });

    await restored;
    expect(assignments.get(victimKey)).toBe('voice-original');
    expect(assignments.get(attackerKey)).toBe('voice-own-choice');

    const snapshot = await waitForSnapshot(band.id, (s) => s.assignments[attackerKey] !== undefined);
    expect(snapshot?.assignments[victimKey]).toBe('voice-original');
    expect(snapshot?.assignments[attackerKey]).toBe('voice-own-choice');
  }, 15000);

  it('a new event pushes to other subscribed members, but never to whoever created it', async () => {
    const creator = await signUpTestUser();
    const other = await signUpTestUser();
    cleanupUserIds.push(creator.userId, other.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Push Notify Band', slug: `test-push-notify-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      // event:create is admin-only (docs/PERMISSIONS.md) — a plain member's
      // direct CRDT write would now be reverted by the role guard below, so
      // this test (which is about push notifications, not authorization)
      // needs the creator to actually hold the role the action requires.
      { bandId: band.id, userId: creator.userId, role: 'admin', instruments: [] },
      { bandId: band.id, userId: other.userId, role: 'member', instruments: [] },
    ]);
    await db.insert(userPrefs).values({
      userId: other.userId,
      pushTriggers: {
        eventCreated: true,
        eventChanged: false,
        pollCreated: false,
        missingResponseReminder: false,
        upcomingEventReminder: false,
      },
    });
    await db
      .insert(pushSubscriptions)
      .values({
        userId: other.userId,
        endpoint: `https://push.example.test/${randomUUID()}`,
        p256dh: 'p',
        auth: 'a',
      });

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    const port = hocuspocusServer.configuration.port;
    if (!port) throw new Error('Hocuspocus server has no port configured');
    extraProvider = await connectSynced(port, band.id, creator.token);

    extraProvider.document.getMap('events').set(`event-${randomUUID()}`, {
      type: 'rehearsal',
      title: 'Freshly Created Rehearsal',
      startsAt: Date.parse('2026-02-01T18:00:00.000Z'),
      allDay: false,
      status: 'confirmed',
    });

    const deadline = Date.now() + 8000;
    while (
      (fake.sendNotification as ReturnType<typeof vi.fn>).mock.calls.length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(fake.sendNotification).toHaveBeenCalledTimes(1);
  }, 15000);
});
