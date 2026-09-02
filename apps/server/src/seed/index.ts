// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm seed` — Definition of Done for Milestone 0, not a stretch goal:
// three demo users, two bands, 12 songs with real ChordPro content, two
// setlists. Idempotent: re-running it deletes the demo bands (by slug) and
// everything scoped to them — cascading via each table's own bandId FK —
// then recreates them fresh, rather than either erroring on unique
// constraints or silently leaving a previous run's accumulated state (band
// docs mutated by hand or by acceptance tests) in place. Demo users
// (alice/bob/carol) are identity, not band-scoped, so they're reused, not
// recreated.
//
// Two bands, not one, as of the permissions hardening round: alice/bob
// have swapped roles between them, and carol only exists in the second —
// so every role (owner/admin/member) is visible somewhere without having
// to manually create bands/members while developing role-gated UI.
//
// assertNotProduction() below refuses to run this against a real
// deployment at all: it creates three working accounts with a password
// published in this repository, and the delete-by-slug step could destroy
// a real band whose user-chosen name happened to slugify to the same
// value.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createEvent,
  createPoll,
  createRecurringEvent,
  createVoice,
  generateInviteCode,
  getDefaultVoiceId,
  listPolls,
  respondAvailability,
  sha256Hex,
  votePoll,
  yDocToSnapshot,
} from '@bandstand/core';
import * as Y from 'yjs';
import { eq, inArray } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { db } from '../db/client';
import { attachments, bandDocs, bandMembers, bands, invites, users } from '../db/schema/index';
import { isDevelopmentOrTest } from '../lib/envGuard';
import { putObjectDirect } from '../lib/storage';
import { seedSongs } from './songs';

const SEED_FORCE_OVERRIDE = 'i-know-what-im-doing';

/**
 * Same shape as scripts/cleanupTestAccounts.ts's own guard, but fail-closed
 * like envGuard.ts's (unless NODE_ENV is explicitly development or test)
 * rather than only firing when NODE_ENV is explicitly 'production' — this
 * script's risk is sharper than that one's, not milder: it doesn't just
 * touch test-%-prefixed rows, it creates three real, working accounts
 * whose password is published in this repository, and deletes any band
 * whose slug happens to collide with a demo slug — slugs come from
 * user-chosen band names (slugify), so "demo-band" is a name a real band
 * could plausibly have taken. `pnpm start`, the real long-running-
 * deployment path, never sets NODE_ENV at all, so gating only on the
 * literal 'production' value would leave exactly that path unprotected.
 */
export function assertNotProduction(): void {
  if (isDevelopmentOrTest()) return;
  if (process.env.SEED_FORCE === SEED_FORCE_OVERRIDE) return;

  throw new Error(
    'pnpm seed must never run against a non-development database. It creates demo accounts with a ' +
      'password published in this repository and deletes any band whose slug matches a demo slug. ' +
      `Set NODE_ENV=development (or NODE_ENV=test), or SEED_FORCE=${SEED_FORCE_OVERRIDE} to override ` +
      '(e.g. for a throwaway demo instance).',
  );
}

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
// `name` is a per-user account field, not per-band — it must stay accurate
// in both bands even though these three hold a different role in each, so
// it never bakes in a role (that used to say "Bob (member)" even in Second
// Fiddle, where he's the owner).
const DEMO_USERS = [
  { email: 'alice@bandstand.local', name: 'Alice', role: 'owner' as const },
  { email: 'bob@bandstand.local', name: 'Bob', role: 'member' as const },
  // Also an admin here (not just in Second Fiddle) so the calendar/poll
  // admin-gated actions (event:create/delete, poll:create/close) have a
  // non-owner admin to exercise in the main demo band too.
  { email: 'carol@bandstand.local', name: 'Carol', role: 'admin' as const },
];
// In the second band, the same three people have different roles —
// bob owns it, alice is just a member, and carol (new) is an admin.
const SECOND_BAND_USERS = [
  { email: 'bob@bandstand.local', name: 'Bob', role: 'owner' as const },
  { email: 'alice@bandstand.local', name: 'Alice', role: 'member' as const },
  { email: 'carol@bandstand.local', name: 'Carol', role: 'admin' as const },
];

async function ensureUser(email: string, name: string): Promise<string> {
  const [existing] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email));
  if (existing) {
    // A demo user's identity is reused across reseeds, but its name isn't
    // frozen at first creation either — otherwise a name fixed here (like
    // dropping the old "Bob (member)" role suffix) would never actually
    // take effect on an already-seeded database, only on a fresh one.
    if (existing.name !== name) await db.update(users).set({ name }).where(eq(users.id, existing.id));
    return existing.id;
  }

  const result = await auth.api.signUpEmail({
    body: { email, password: DEMO_PASSWORD, name },
  });
  return result.user.id;
}

async function main() {
  assertNotProduction();

  // Logged *before* the delete, not just as an afterwards count — an
  // operator watching this run against the wrong database still has a
  // chance to Ctrl-C before the second (real seeding) half does anything
  // further, but only if they can see which band, by name, is about to go.
  const toDelete = await db
    .select({ slug: bands.slug, name: bands.name })
    .from(bands)
    .where(inArray(bands.slug, [DEMO_BAND_SLUG, SECOND_BAND_SLUG]));
  for (const band of toDelete) {
    console.log(`Deleting existing band "${band.name}" (slug: ${band.slug}) before reseeding...`);
  }

  const deleted = await db
    .delete(bands)
    .where(inArray(bands.slug, [DEMO_BAND_SLUG, SECOND_BAND_SLUG]))
    .returning({ slug: bands.slug });
  if (deleted.length > 0) {
    console.log(`Reset ${deleted.length} existing demo band(s) (${deleted.map((b) => b.slug).join(', ')}) before reseeding.`);
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

  // Milestone 3: calendar events + an open scheduling poll. Relative to
  // "now" (never a hardcoded date) so "one event in the past" and "one
  // still-open poll" stay true no matter when `pnpm seed` actually runs.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const seedNow = Date.now();
  const [aliceId, bobId] = userIds as [string, string, string];

  createEvent(doc, {
    type: 'rehearsal',
    title: "Last week's rehearsal",
    startsAt: seedNow - 14 * DAY_MS,
    allDay: false,
    status: 'confirmed',
  });

  const seriesId = createRecurringEvent(
    doc,
    {
      type: 'rehearsal',
      title: 'Weekly rehearsal',
      startsAt: seedNow + 3 * DAY_MS,
      allDay: false,
      status: 'confirmed',
      location: 'The Practice Space',
    },
    { freq: 'weekly', until: new Date(seedNow + 90 * DAY_MS).toISOString().slice(0, 10) },
  );

  createEvent(doc, {
    type: 'gig',
    title: 'Open Mic Night',
    startsAt: seedNow + 20 * DAY_MS,
    allDay: false,
    status: 'confirmed',
    location: 'The Grinning Goat, 123 Main St',
    locationGeo: { lat: 52.52, lng: 13.405 },
    setlistId: 'setlist-open-mic',
  });

  createEvent(doc, {
    type: 'gig',
    title: 'Maybe a wedding gig',
    startsAt: seedNow + 30 * DAY_MS,
    allDay: false,
    status: 'tentative',
  });

  createEvent(doc, {
    type: 'other',
    title: 'Studio day',
    startsAt: seedNow + 10 * DAY_MS,
    allDay: false,
    status: 'cancelled',
  });

  const firstRehearsalOccurrence = `${seriesId}@${new Date(seedNow + 3 * DAY_MS).toISOString().slice(0, 10)}`;
  respondAvailability(doc, firstRehearsalOccurrence, aliceId, 'yes');
  respondAvailability(doc, firstRehearsalOccurrence, bobId, 'maybe');
  // Carol deliberately doesn't answer — demonstrates the "still open" state.

  const pollId = createPoll(doc, {
    title: 'When should we rehearse before the gig?',
    options: [{ startsAt: seedNow + 5 * DAY_MS }, { startsAt: seedNow + 6 * DAY_MS }, { startsAt: seedNow + 7 * DAY_MS }],
  });
  const pollOptions = listPolls(doc)[pollId]!.options;
  votePoll(doc, pollId, pollOptions[0]!.id, aliceId, 'yes');
  votePoll(doc, pollId, pollOptions[1]!.id, bobId, 'maybe');
  // Carol deliberately doesn't vote either.

  const snapshot = yDocToSnapshot(doc);
  const yjsState = Buffer.from(Y.encodeStateAsUpdate(doc));

  await db.insert(bandDocs).values({ bandId: band.id, yjsState, snapshot });

  console.log('Seeded demo data:');
  console.log(`  Band: "${band.name}" (slug: ${band.slug})`);
  console.log(`  Songs: ${Object.keys(seedSongs).length}`);
  console.log('  "Amazing Grace" has 3 voices: ChordPro, Trumpet in B♭ (1 page), Full Score (2 pages)');
  console.log('  Setlists: 2');
  console.log('  Invites: 1 open, 1 redeemed');
  console.log('  Events: 5 (one in the past, one a weekly series through +90 days)');
  console.log('  Polls: 1 open ("When should we rehearse before the gig?"), voted by alice + bob, not carol');
  for (const u of DEMO_USERS) {
    console.log(`  Login: ${u.email} / ${DEMO_PASSWORD} (${u.role})`);
  }
  console.log(`  Band: "${secondBand.name}" (slug: ${secondBand.slug})`);
  for (const u of SECOND_BAND_USERS) {
    console.log(`  Login: ${u.email} / ${DEMO_PASSWORD} (${u.role})`);
  }
  process.exit(0);
}

// Only run as a CLI when invoked directly (`pnpm seed`), not when imported
// by a test — see assertNotProduction's own test file, which imports this
// module just for that one function. Without this guard, that import alone
// used to run the real seed against whatever DATABASE_URL the test process
// had, unconditionally, the same bug class scripts/cleanupTestAccounts.ts
// and blobs/gc.ts already guard against this same way.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
