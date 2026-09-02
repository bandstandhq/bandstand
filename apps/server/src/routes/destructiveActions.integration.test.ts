// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres + a real band Yjs document persisted to band_docs, exercised
// through the actual, fully composed app (../app.ts) — proving the role
// check and the withBandDoc write actually apply to real data, not just
// that can()/canRemoveMember() return the right booleans in isolation
// (packages/core's matrix.test.ts already covers that). See
// docs/adr/0005-permissions.md.
import { randomUUID } from 'node:crypto';
import { getDefaultVoiceId, yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { attachments, bandDocs, bandMembers, bands, userPrefs, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-destructive-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Destructive Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return app.request(`/bands${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// Registers every user/band it creates for cleanup itself — a caller that
// only destructures the fields it needs (e.g. `{ band, admin, member }`)
// used to also have to remember to separately push every id it got back
// into cleanupUserIds/cleanupBandIds, and every call site here forgot at
// least `owner` (see issue for the accumulated leak this caused). Taking
// the arrays as parameters and pushing internally makes that impossible to
// forget again.
async function setupBand(cleanupUserIds: string[], cleanupBandIds: string[]) {
  const owner = await signUpTestUser();
  const admin = await signUpTestUser();
  const member = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Destructive Test Band', slug: `test-destructive-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');
  cleanupUserIds.push(owner.userId, admin.userId, member.userId);
  cleanupBandIds.push(band.id);

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

  const filesVoiceId = `voice:${randomUUID()}`;
  doc.getMap('voices').set(filesVoiceId, {
    songId,
    name: 'Trumpet in B',
    kind: 'files',
    files: [
      { sha256: 'a'.repeat(64), filename: 'part-1.pdf', mime: 'application/pdf', pageCount: 1 },
      { sha256: 'b'.repeat(64), filename: 'part-2.pdf', mime: 'application/pdf', pageCount: 1 },
    ],
  });

  await db.insert(bandDocs).values({
    bandId: band.id,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
    snapshot: yDocToSnapshot(doc),
  });

  return { band, owner, admin, member, songId, setlistId, filesVoiceId };
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
    const { band, admin, member, songId, setlistId } = await setupBand(cleanupUserIds, cleanupBandIds);

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
    const { band, admin, songId, setlistId } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/songs/${songId}/delete-impact`, 'GET', admin.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affectedSetlists: ['Test Setlist'], hasPersonalNotes: false });

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.songs[songId]).toBeDefined();
    expect(snapshot?.setlists[setlistId]?.items).toHaveLength(1);
  });

  it('delete-impact reports personal notes left behind by any member', async () => {
    const { band, admin, member, songId } = await setupBand(cleanupUserIds, cleanupBandIds);

    await db
      .insert(userPrefs)
      .values({ userId: member.userId, songNotes: { [songId]: { notes: 'capo 2', checklist: [] } } });

    const res = await req(`/${band.id}/songs/${songId}/delete-impact`, 'GET', admin.token);
    expect(await res.json()).toMatchObject({ hasPersonalNotes: true });
  });

  it('deleting a song forever clears every member\'s personal notes for it', async () => {
    const { band, admin, member, songId } = await setupBand(cleanupUserIds, cleanupBandIds);

    await db
      .insert(userPrefs)
      .values({ userId: member.userId, songNotes: { [songId]: { notes: 'capo 2', checklist: [] } } });

    const res = await req(`/${band.id}/songs/${songId}`, 'DELETE', admin.token);
    expect(res.status).toBe(200);

    const [row] = await db.select({ songNotes: userPrefs.songNotes }).from(userPrefs).where(eq(userPrefs.userId, member.userId));
    expect(row?.songNotes).toEqual({});
  });

  // Regression tests: songId is a Yjs map key, not a foreign key — nothing
  // previously verified it belonged to the band in the URL, so any band
  // (a throwaway one included, since registration is open and creating a
  // band makes you its owner) could DELETE or probe delete-impact for an
  // arbitrary songId it had never even seen, e.g. a former member's old
  // band, known from an earlier repertoire export.
  it("rejects deleting a song id that belongs to a different band, and leaves that other band's personal notes untouched", async () => {
    const victimBand = await setupBand(cleanupUserIds, cleanupBandIds);
    const attacker = await signUpTestUser();
    cleanupUserIds.push(attacker.userId);

    await db
      .insert(userPrefs)
      .values({ userId: victimBand.member.userId, songNotes: { [victimBand.songId]: { notes: 'capo 2', checklist: [] } } });

    const createOwnBand = await req('', 'POST', attacker.token, { name: 'Attacker Band' });
    expect(createOwnBand.status).toBe(201);
    const ownBand = (await createOwnBand.json()) as { id: string };
    cleanupBandIds.push(ownBand.id);

    const attack = await req(`/${ownBand.id}/songs/${victimBand.songId}`, 'DELETE', attacker.token);
    expect(attack.status).toBe(404);

    // The victim band's song, and the notes anyone wrote for it, are
    // completely untouched.
    const snapshot = await loadSnapshot(victimBand.band.id);
    expect(snapshot?.songs[victimBand.songId]).toBeDefined();
    const [row] = await db
      .select({ songNotes: userPrefs.songNotes })
      .from(userPrefs)
      .where(eq(userPrefs.userId, victimBand.member.userId));
    expect(row?.songNotes).toHaveProperty(victimBand.songId);
  });

  it('rejects delete-impact for a song id that belongs to a different band, rather than leaking whether anyone has notes for it', async () => {
    const victimBand = await setupBand(cleanupUserIds, cleanupBandIds);
    const attacker = await signUpTestUser();
    cleanupUserIds.push(attacker.userId);

    await db
      .insert(userPrefs)
      .values({ userId: victimBand.member.userId, songNotes: { [victimBand.songId]: { notes: 'capo 2', checklist: [] } } });

    const createOwnBand = await req('', 'POST', attacker.token, { name: 'Attacker Band' });
    const ownBand = (await createOwnBand.json()) as { id: string };
    cleanupBandIds.push(ownBand.id);

    const res = await req(`/${ownBand.id}/songs/${victimBand.songId}/delete-impact`, 'GET', attacker.token);
    expect(res.status).toBe(404);
  });

  it("scopes a song's personal-notes cleanup to this band's own members, leaving an outsider's notes for the same song id untouched", async () => {
    const { band, admin, member, songId } = await setupBand(cleanupUserIds, cleanupBandIds);
    const outsider = await signUpTestUser();
    cleanupUserIds.push(outsider.userId);

    await db.insert(userPrefs).values([
      { userId: member.userId, songNotes: { [songId]: { notes: 'capo 2', checklist: [] } } },
      // Not a member of `band` at all — just happens to have a userPrefs
      // row keyed by the exact same songId, since user_prefs has no band
      // column of its own to naturally scope by.
      { userId: outsider.userId, songNotes: { [songId]: { notes: 'unrelated notes', checklist: [] } } },
    ]);

    const res = await req(`/${band.id}/songs/${songId}`, 'DELETE', admin.token);
    expect(res.status).toBe(200);

    const [memberRow] = await db.select({ songNotes: userPrefs.songNotes }).from(userPrefs).where(eq(userPrefs.userId, member.userId));
    expect(memberRow?.songNotes).toEqual({});

    const [outsiderRow] = await db.select({ songNotes: userPrefs.songNotes }).from(userPrefs).where(eq(userPrefs.userId, outsider.userId));
    expect(outsiderRow?.songNotes).toHaveProperty(songId);
  });

  it('rejects a member deleting a setlist, but lets an admin', async () => {
    const { band, admin, member, setlistId } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/setlists/${setlistId}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/setlists/${setlistId}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.setlists[setlistId]).toBeUndefined();
  });

  it('rejects a member and an admin deleting the band, but lets the owner', async () => {
    const { band, admin, member, owner } = await setupBand(cleanupUserIds, cleanupBandIds);

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
    const { band, admin, member, songId } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/songs/${songId}/resolve-tie`, 'POST', member.token, { resolution: 'archived' });
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/songs/${songId}/resolve-tie`, 'POST', admin.token, { resolution: 'archived' });
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.songs[songId]?.status).toBe('archived');
  });

  it('rejects a member detaching a file, but lets an admin, keeping the other file', async () => {
    const { band, admin, member, songId, filesVoiceId } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}/files/${'a'.repeat(64)}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}/files/${'a'.repeat(64)}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    const files = snapshot?.voices[filesVoiceId]?.kind === 'files' ? snapshot.voices[filesVoiceId].files : undefined;
    expect(files?.map((f) => f.sha256)).toEqual(['b'.repeat(64)]);
  });

  it('rejects a member deleting a whole voice, but lets an admin', async () => {
    const { band, admin, member, songId, filesVoiceId } = await setupBand(cleanupUserIds, cleanupBandIds);

    const forbidden = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.voices[filesVoiceId]).toBeUndefined();
  });

  it('rejects a member overwriting a voice file, but lets an admin, only once the new content is actually confirmed uploaded', async () => {
    const { band, admin, member, songId, filesVoiceId } = await setupBand(cleanupUserIds, cleanupBandIds);
    const newFile = { sha256: 'c'.repeat(64), filename: 'part-1-corrected.pdf', mime: 'application/pdf', pageCount: 2 };

    const forbidden = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}/files/${'a'.repeat(64)}/overwrite`, 'POST', member.token, newFile);
    expect(forbidden.status).toBe(403);

    // An admin, but nobody ever actually uploaded/confirmed newFile's hash —
    // this must not let a caller point a voice at bytes that don't exist.
    const notConfirmed = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}/files/${'a'.repeat(64)}/overwrite`, 'POST', admin.token, newFile);
    expect(notConfirmed.status).toBe(400);

    await db.insert(attachments).values({ bandId: band.id, sha256: newFile.sha256, filename: newFile.filename, mime: newFile.mime, size: 1234 });

    const ok = await req(`/${band.id}/songs/${songId}/voices/${filesVoiceId}/files/${'a'.repeat(64)}/overwrite`, 'POST', admin.token, newFile);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    const files = snapshot?.voices[filesVoiceId]?.kind === 'files' ? snapshot.voices[filesVoiceId].files : undefined;
    expect(files?.map((f) => f.sha256)).toEqual([newFile.sha256, 'b'.repeat(64)]);
  });
});
