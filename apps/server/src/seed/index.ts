// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm seed` — Definition of Done for Milestone 0, not a stretch goal:
// two demo users, one band, 12 songs with real ChordPro content, two
// setlists. Idempotent: re-running it after the demo band already exists
// just reports that and exits, rather than erroring on unique constraints.
//
// Two bands, not one, as of the permissions hardening round: alice/bob
// have swapped roles between them, and carol only exists in the second —
// so every role (owner/admin/member) is visible somewhere without having
// to manually create bands/members while developing role-gated UI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createVoice, generateInviteCode, getDefaultVoiceId, sha256Hex, yDocToSnapshot } from '@bandstand/core';
import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { db } from '../db/client';
import { attachments, bandDocs, bandMembers, bands, invites, users } from '../db/schema/index';
import { putObjectDirect } from '../lib/storage';
import { seedSongs } from './songs';

const ASSETS_DIR = fileURLToPath(new URL('./assets', import.meta.url));

// Two small public-domain PDF scores (an original chord-tone arrangement of
// the traditional, long-public-domain "Amazing Grace" tune, not a
// transcription of any copyrighted edition) — see A5 in the Milestone 2
// plan. Uploaded directly via storage.ts's S3 client rather than looping
// through the presigned-URL flow: seeding isn't a real client, so there's
// no reason to round-trip through the HTTP API to reach the same bucket.
const SEED_VOICE_PDFS = [
  { filename: 'amazing-grace-trumpet.pdf', pageCount: 1, voiceName: 'Trumpet in B♭', instrument: 'Trumpet' },
  { filename: 'amazing-grace-full-score.pdf', pageCount: 2, voiceName: 'Full Score', instrument: undefined },
];

async function uploadSeedAsset(bandId: string, uploadedBy: string, filename: string): Promise<string> {
  const bytes = readFileSync(`${ASSETS_DIR}/${filename}`);
  const sha256 = await sha256Hex(bytes);
  await putObjectDirect(sha256, bytes, 'application/pdf');
  await db
    .insert(attachments)
    .values({ bandId, sha256, filename, mime: 'application/pdf', size: bytes.byteLength, uploadedBy })
    .onConflictDoNothing({ target: [attachments.bandId, attachments.sha256] });
  return sha256;
}

const DEMO_BAND_SLUG = 'demo-band';
const SECOND_BAND_SLUG = 'second-fiddle';
const DEMO_PASSWORD = 'bandstand-demo';
const DEMO_USERS = [
  { email: 'alice@bandstand.local', name: 'Alice (owner)', role: 'owner' as const },
  { email: 'bob@bandstand.local', name: 'Bob (member)', role: 'member' as const },
];
// In the second band, the same three people have different roles —
// bob owns it, alice is just a member, and carol (new) is an admin.
const SECOND_BAND_USERS = [
  { email: 'bob@bandstand.local', name: 'Bob (member)', role: 'owner' as const },
  { email: 'alice@bandstand.local', name: 'Alice (owner)', role: 'member' as const },
  { email: 'carol@bandstand.local', name: 'Carol (admin)', role: 'admin' as const },
];

async function ensureUser(email: string, name: string): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return existing.id;

  const result = await auth.api.signUpEmail({
    body: { email, password: DEMO_PASSWORD, name },
  });
  return result.user.id;
}

async function main() {
  const [existingBand] = await db.select().from(bands).where(eq(bands.slug, DEMO_BAND_SLUG));
  if (existingBand) {
    console.log(`Already seeded — band "${DEMO_BAND_SLUG}" exists. Nothing to do.`);
    process.exit(0);
  }

  const userIds = await Promise.all(DEMO_USERS.map((u) => ensureUser(u.email, u.name)));

  const [band] = await db
    .insert(bands)
    .values({ name: 'The Demo Band', slug: DEMO_BAND_SLUG })
    .returning();
  if (!band) throw new Error('Failed to create demo band');

  await db.insert(bandMembers).values(
    DEMO_USERS.map((u, i) => ({
      bandId: band.id,
      userId: userIds[i]!,
      role: u.role,
      instruments: [],
    })),
  );

  const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(invites).values([
    {
      bandId: band.id,
      code: generateInviteCode(),
      label: 'For the new drummer',
      role: 'member',
      createdBy: userIds[0], // alice
      expiresAt: inviteExpiry,
    },
    {
      bandId: band.id,
      code: generateInviteCode(),
      label: "Bob's invite",
      role: 'member',
      createdBy: userIds[0], // alice
      expiresAt: inviteExpiry,
      redeemedBy: userIds[1], // bob
      redeemedAt: new Date(),
    },
  ]);

  // A second band with the same three people in different roles — bob
  // owns it, alice is just a member there, and carol (admin) doesn't
  // exist in the first band at all — so every role is visible somewhere
  // without hand-creating a band while developing role-gated UI.
  const secondBandUserIds = await Promise.all(SECOND_BAND_USERS.map((u) => ensureUser(u.email, u.name)));
  const [secondBand] = await db
    .insert(bands)
    .values({ name: 'Second Fiddle', slug: SECOND_BAND_SLUG })
    .returning();
  if (!secondBand) throw new Error('Failed to create second demo band');

  await db.insert(bandMembers).values(
    SECOND_BAND_USERS.map((u, i) => ({
      bandId: secondBand.id,
      userId: secondBandUserIds[i]!,
      role: u.role,
      instruments: [],
    })),
  );

  // Minimal — this band exists to demonstrate role differences, not to
  // duplicate the main demo band's repertoire/setlists.
  const secondDoc = new Y.Doc();
  await db.insert(bandDocs).values({
    bandId: secondBand.id,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(secondDoc)),
    snapshot: yDocToSnapshot(secondDoc),
  });

  const doc = new Y.Doc();
  const songsMap = doc.getMap('songs');
  const voicesMap = doc.getMap('voices');
  for (const [songId, seedSong] of Object.entries(seedSongs)) {
    songsMap.set(songId, seedSong.song);
    voicesMap.set(getDefaultVoiceId(songId), {
      songId,
      name: 'Default',
      body: seedSong.body,
    });
  }

  // Milestone 2 A5: "Amazing Grace" additionally carries two files-kind
  // voices (a single-page Bb trumpet part and a two-page full score), so
  // one seeded song exercises all three voice kinds' worth of the
  // multi-voice pipeline — different page counts included.
  for (const pdf of SEED_VOICE_PDFS) {
    const sha256 = await uploadSeedAsset(band.id, userIds[0]!, pdf.filename);
    createVoice(doc, 'song-amazing-grace', {
      name: pdf.voiceName,
      kind: 'files',
      instrument: pdf.instrument,
      files: [{ sha256, filename: pdf.filename, mime: 'application/pdf', pageCount: pdf.pageCount }],
    });
  }

  const activeSongIds = Object.entries(seedSongs)
    .filter(([, s]) => s.song.status === 'active')
    .map(([id]) => id);

  const setlistsMap = doc.getMap('setlists');
  setlistsMap.set('setlist-open-mic', {
    name: 'Open Mic Night',
    eventDate: '2026-09-12',
    updatedAt: Date.now(),
  });
  doc.getArray('items:setlist-open-mic').push([
    { id: 'item-1', type: 'song', songId: activeSongIds[0] },
    { id: 'item-2', type: 'song', songId: activeSongIds[1] },
    { id: 'item-3', type: 'break', breakMinutes: 15 },
    { id: 'item-4', type: 'song', songId: activeSongIds[2] },
    { id: 'item-5', type: 'finale' },
  ]);

  setlistsMap.set('setlist-full-set', {
    name: 'Full Band Practice Set',
    updatedAt: Date.now(),
  });
  doc.getArray('items:setlist-full-set').push(
    activeSongIds.map((songId, i) => ({ id: `full-item-${i}`, type: 'song' as const, songId })),
  );

  const snapshot = yDocToSnapshot(doc);
  const yjsState = Buffer.from(Y.encodeStateAsUpdate(doc));

  await db.insert(bandDocs).values({ bandId: band.id, yjsState, snapshot });

  console.log('Seeded demo data:');
  console.log(`  Band: "${band.name}" (slug: ${band.slug})`);
  console.log(`  Songs: ${Object.keys(seedSongs).length}`);
  console.log('  "Amazing Grace" has 3 voices: ChordPro, Trumpet in B♭ (1 page), Full Score (2 pages)');
  console.log('  Setlists: 2');
  console.log('  Invites: 1 open, 1 redeemed');
  for (const u of DEMO_USERS) {
    console.log(`  Login: ${u.email} / ${DEMO_PASSWORD} (${u.role})`);
  }
  console.log(`  Band: "${secondBand.name}" (slug: ${secondBand.slug})`);
  for (const u of SECOND_BAND_USERS) {
    console.log(`  Login: ${u.email} / ${DEMO_PASSWORD} (${u.role})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
