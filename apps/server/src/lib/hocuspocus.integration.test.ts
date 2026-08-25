// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres and a real WebSocket round-trip — the whole point
// is proving a non-member's connection is genuinely rejected by the real
// Hocuspocus server, not just that getBandMembership() returns null in
// isolation. Closes https://github.com/bandstandhq/bandstand/issues/1.
import { randomUUID } from 'node:crypto';
import { getDefaultVoiceId, HOCUSPOCUS_AUTH_FAILURE_REASON, yDocToSnapshot } from '@bandstand/core';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, users } from '../db/schema/index';
import { auth } from './auth';
import { hocuspocusServer } from './hocuspocus';

async function signUpTestUser() {
  const email = `hocuspocus-auth-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'HP Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

type ConnectResult = { status: 'connected' } | { status: 'rejected'; reason: string };

function attemptConnect(port: number, bandId: string, token: string): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const config: ConstructorParameters<typeof HocuspocusProvider>[0] & { WebSocketPolyfill?: unknown } = {
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

function connectSynced(port: number, bandId: string, token: string): Promise<HocuspocusProvider> {
  return new Promise((resolve) => {
    const config: ConstructorParameters<typeof HocuspocusProvider>[0] & { WebSocketPolyfill?: unknown } = {
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

  beforeAll(async () => {
    await hocuspocusServer.listen();
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
      .values({ name: 'HP Auth Test Band', slug: `hp-auth-test-${randomUUID()}` })
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
      .values({ name: 'Guard Test Band', slug: `guard-test-${randomUUID()}` })
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
    seedDoc.getMap('voices').set(getDefaultVoiceId(songId), { songId, name: 'Default', body: '{title: Guarded Song}' });
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
    const [row] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, band.id));
    expect(row?.snapshot?.songs[songId]).toMatchObject({ title: 'Guarded Song' });
  }, 15000);
});
