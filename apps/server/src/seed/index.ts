// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm seed` — Definition of Done for Milestone 0, not a stretch goal:
// two demo users, one band, 12 songs with real ChordPro content, two
// setlists. Idempotent: re-running it after the demo band already exists
// just reports that and exits, rather than erroring on unique constraints.
import { yDocToSnapshot } from '@bandstand/core';
import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, users } from '../db/schema/index';
import { seedSongs } from './songs';

const DEMO_BAND_SLUG = 'demo-band';
const DEMO_PASSWORD = 'bandstand-demo';
const DEMO_USERS = [
  { email: 'alice@bandstand.local', name: 'Alice (owner)', role: 'owner' as const },
  { email: 'bob@bandstand.local', name: 'Bob (member)', role: 'member' as const },
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

  const doc = new Y.Doc();
  const songsMap = doc.getMap('songs');
  for (const [songId, songData] of Object.entries(seedSongs)) {
    songsMap.set(songId, songData);
  }

  const activeSongIds = Object.entries(seedSongs)
    .filter(([, s]) => s.status === 'active')
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
  console.log('  Setlists: 2');
  for (const u of DEMO_USERS) {
    console.log(`  Login: ${u.email} / ${DEMO_PASSWORD} (${u.role})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
