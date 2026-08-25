// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres + a real band Yjs document persisted to band_docs, exercised
// through the actual REST routes (bandsRoute, composed exactly as index.ts
// mounts it) — proving the role check and the withBandDoc write actually
// apply to real data, not just that can()/canRemoveMember() return the
// right booleans in isolation (packages/core's matrix.test.ts already
// covers that). See docs/adr/0005-permissions.md.
import { randomUUID } from 'node:crypto';
import { getDefaultVoiceId, yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, userPrefs, users } from '../db/schema/index';
import { auth } from '../lib/auth';
import { bandsRoute } from './bands';

async function signUpTestUser() {
  const email = `destructive-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Destructive Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return bandsRoute.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function setupBand() {
  const owner = await signUpTestUser();
  const admin = await signUpTestUser();
  const member = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Destructive Test Band', slug: `destructive-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');

  await db.insert(bandMembers).values([
    { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
    { bandId: band.id, userId: admin.userId, role: 'admin', instruments: [] },
    { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
  ]);

  const songId = `song-${randomUUID()}`;
  const setlistId = `setlist-${randomUUID()}`;
  const doc = new Y.Doc();
  doc.getMap('songs').set(songId, {
    title: 'Test Song',
    artist: '',
    key: 'C',
    bpm: 120,
    durationSec: 180,
    status: 'active',
    bandNotes: '',
    links: [],
    votes: {},
  });
  doc.getMap('voices').set(getDefaultVoiceId(songId), { songId, name: 'Default', body: '{title: Test Song}' });
  doc.getMap('setlists').set(setlistId, { name: 'Test Setlist', updatedAt: Date.now() });
  doc.getArray(`items:${setlistId}`).push([{ id: 'item-1', type: 'song', songId }]);

  await db.insert(bandDocs).values({
    bandId: band.id,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
    snapshot: yDocToSnapshot(doc),
  });

  return { band, owner, admin, member, songId, setlistId };
}

async function loadSnapshot(bandId: string) {
  const [row] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, bandId));
  return row?.snapshot;
}

describe('destructive band/song/setlist actions (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects a member deleting a song forever, but lets an admin, and removes it from the setlist', async () => {
    const { band, admin, member, songId, setlistId } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const forbidden = await req(`/${band.id}/songs/${songId}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/songs/${songId}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ affectedSetlists: ['Test Setlist'] });

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.songs[songId]).toBeUndefined();
    expect(snapshot?.voices[getDefaultVoiceId(songId)]).toBeUndefined();
    expect(snapshot?.setlists[setlistId]?.items).toEqual([]);
  });

  it('delete-impact previews affected setlists without deleting anything', async () => {
    const { band, admin, songId, setlistId } = await setupBand();
    cleanupUserIds.push(admin.userId);
    cleanupBandIds.push(band.id);

    const res = await req(`/${band.id}/songs/${songId}/delete-impact`, 'GET', admin.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affectedSetlists: ['Test Setlist'], hasPersonalNotes: false });

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.songs[songId]).toBeDefined();
    expect(snapshot?.setlists[setlistId]?.items).toHaveLength(1);
  });

  it('delete-impact reports personal notes left behind by any member', async () => {
    const { band, admin, member, songId } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    await db
      .insert(userPrefs)
      .values({ userId: member.userId, songNotes: { [songId]: { notes: 'capo 2', checklist: [] } } });

    const res = await req(`/${band.id}/songs/${songId}/delete-impact`, 'GET', admin.token);
    expect(await res.json()).toMatchObject({ hasPersonalNotes: true });
  });

  it('deleting a song forever clears every member\'s personal notes for it', async () => {
    const { band, admin, member, songId } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    await db
      .insert(userPrefs)
      .values({ userId: member.userId, songNotes: { [songId]: { notes: 'capo 2', checklist: [] } } });

    const res = await req(`/${band.id}/songs/${songId}`, 'DELETE', admin.token);
    expect(res.status).toBe(200);

    const [row] = await db.select({ songNotes: userPrefs.songNotes }).from(userPrefs).where(eq(userPrefs.userId, member.userId));
    expect(row?.songNotes).toEqual({});
  });

  it('rejects a member deleting a setlist, but lets an admin', async () => {
    const { band, admin, member, setlistId } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const forbidden = await req(`/${band.id}/setlists/${setlistId}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/setlists/${setlistId}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.setlists[setlistId]).toBeUndefined();
  });

  it('rejects a member and an admin deleting the band, but lets the owner', async () => {
    const { band, admin, member, owner } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId, owner.userId);

    const memberForbidden = await req(`/${band.id}`, 'DELETE', member.token);
    expect(memberForbidden.status).toBe(403);

    const adminForbidden = await req(`/${band.id}`, 'DELETE', admin.token);
    expect(adminForbidden.status).toBe(403);

    const ok = await req(`/${band.id}`, 'DELETE', owner.token);
    expect(ok.status).toBe(200);

    const [bandRow] = await db.select().from(bands).where(eq(bands.id, band.id));
    expect(bandRow).toBeUndefined();
  });

  it('rejects a member resolving a tied idea vote, but lets an admin', async () => {
    const { band, admin, member, songId } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const forbidden = await req(`/${band.id}/songs/${songId}/resolve-tie`, 'POST', member.token, { resolution: 'archived' });
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/songs/${songId}/resolve-tie`, 'POST', admin.token, { resolution: 'archived' });
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.songs[songId]?.status).toBe('archived');
  });
});
