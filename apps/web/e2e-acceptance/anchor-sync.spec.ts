// SPDX-License-Identifier: Apache-2.0
//
// The acceptance scenarios docs/adr/0010-anchor-sync.md exists for — real
// Hocuspocus connections for setup (anchors, calibration, assignments; see
// hocuspocusTestClient.ts), real two-browser-context Stage Mode sessions
// for the actual assertions. Two of the six scenarios from the plan aren't
// duplicated here: "another member's voice edit never touches my
// annotations" is already proven at the Postgres level in
// apps/server/src/routes/annotations.integration.test.ts (a more precise
// proof than a UI click-through would add), and the general "an offline
// edit reaches others after reconnecting" property already has its own
// acceptance test (offline-reconnect.spec.ts) — this file's offline
// scenario is scoped to what's specific to Stage Mode instead.
import {
  addSetlistItem,
  addSong,
  buildSongItem,
  createAnchor,
  createVoice,
  getDefaultVoiceId,
  listVoicesForSong,
  setAssignment,
  setVoiceAnchorPosition,
  updateVoiceBody,
} from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { DEMO_MEMBER_EMAIL, DEMO_OWNER_EMAIL, DEMO_PASSWORD, login, stageModeHeading } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { getBandIdBySlug, getSetlistIdByName, getUserIdByEmail, withDb } from './testDb';

const AMAZING_GRACE_SONG_ID = 'song-amazing-grace';

async function connectSetupDoc(bandId: string) {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const client = connectTestBandDoc(bandId, token);
  await client.waitForSynced();
  return client;
}

/** Real Yjs writes go out over an open WebSocket as soon as they're made, but destroying the provider right after gives them no chance to actually leave — a short pause first is cheap insurance, same reasoning as the setup/teardown timing already used for the assignment reverts below. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

async function gotoStageForSong(
  page: import('@playwright/test').Page,
  bandId: string,
  setlistName: string,
  songTitle: string,
) {
  await page.goto(`/bands/${bandId}/setlists`);
  const switchToListView = page.getByRole('button', { name: 'List view' });
  if (await switchToListView.isVisible().catch(() => false)) await switchToListView.click();
  await page.locator('li', { hasText: setlistName }).getByRole('link', { name: 'Open' }).click();
  const matchingLink = page.locator('a', { hasText: songTitle }).first();
  await matchingLink.waitFor({ state: 'visible', timeout: 15000 });
  await matchingLink.click();
  await page.waitForURL(/\/stage\//);
}

/**
 * Navigating away *before* closing a context lets Stage Mode's own unmount
 * effect clear this session's Awareness entry — `context.close()` alone
 * doesn't run that cleanup, and a closed-but-not-yet-expired connection's
 * stale "Alice"/"Bob" entry can otherwise still show up as a followable
 * peer (or a stale item/position) for a short window in whichever test
 * runs next, since these acceptance scenarios all share one real seeded
 * band/setlist rather than an isolated one each.
 */
async function leaveStageMode(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  await page.waitForTimeout(200);
}

test.describe('anchor-based Stage Mode sync (docs/adr/0010-anchor-sync.md)', () => {
  test('different voices, different content: jumping to an anchor lands each device at its own calibrated position', async ({
    browser,
  }) => {
    const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
    const [aliceUserId, bobUserId] = await Promise.all([
      withDb((c) => getUserIdByEmail(c, DEMO_OWNER_EMAIL)),
      withDb((c) => getUserIdByEmail(c, DEMO_MEMBER_EMAIL)),
    ]);
    const setup = await connectSetupDoc(bandId);
    const voices = listVoicesForSong(setup.doc, AMAZING_GRACE_SONG_ID);
    const defaultVoiceId = getDefaultVoiceId(AMAZING_GRACE_SONG_ID);
    const fullScoreVoiceId = voices.find((v) => v.voice.name === 'Full Score')!.id;

    const anchorId = createAnchor(setup.doc, AMAZING_GRACE_SONG_ID, { label: 'Acceptance Chorus' });
    const chordProVoice = setup.doc.getMap('voices').get(defaultVoiceId) as { body: string };
    updateVoiceBody(
      setup.doc,
      defaultVoiceId,
      `${chordProVoice.body}\n\n{start_of_chorus: label="Acceptance Chorus"}\n[G]Chorus marker for acceptance testing[G]\n{end_of_chorus}`,
    );
    setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, anchorId, { fileIndex: 0, page: 2, yPct: 0 });
    setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, aliceUserId, fullScoreVoiceId);
    setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, bobUserId, defaultVoiceId);
    await flush();

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    try {
      await login(alice, DEMO_OWNER_EMAIL);
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoStageForSong(alice, bandId, 'Full Band Practice Set', 'Amazing Grace');
      await gotoStageForSong(bob, bandId, 'Full Band Practice Set', 'Amazing Grace');

      await bob.getByRole('button', { name: 'Follow' }).click();
      await bob.getByRole('button', { name: /^Alice/ }).click();

      // Alice's Full Score is on page 1; page 2 is calibrated to "Acceptance Chorus".
      await alice.getByRole('button', { name: 'Next' }).first().click();
      await expect(bob.getByText('Chorus marker for acceptance testing').first()).toBeInViewport({ timeout: 5000 });
    } finally {
      await leaveStageMode(alice).catch(() => {});
      await leaveStageMode(bob).catch(() => {});
      await aliceContext.close();
      await bobContext.close();
      setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, aliceUserId, defaultVoiceId);
      setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, bobUserId, defaultVoiceId);
      await flush();
      setup.provider.destroy();
    }
  });

  test('an anchor unknown to the follower\'s voice walks back to the nearest known one, with a hint', async ({ browser }) => {
    const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
    const [aliceUserId, bobUserId] = await Promise.all([
      withDb((c) => getUserIdByEmail(c, DEMO_OWNER_EMAIL)),
      withDb((c) => getUserIdByEmail(c, DEMO_MEMBER_EMAIL)),
    ]);
    const setup = await connectSetupDoc(bandId);
    const voices = listVoicesForSong(setup.doc, AMAZING_GRACE_SONG_ID);
    const fullScoreVoiceId = voices.find((v) => v.voice.name === 'Full Score')!.id;
    const trumpetVoiceId = voices.find((v) => v.voice.name === 'Trumpet in B♭')!.id;

    const introAnchorId = createAnchor(setup.doc, AMAZING_GRACE_SONG_ID, { label: 'Acceptance Intro' });
    const chorusAnchorId = createAnchor(setup.doc, AMAZING_GRACE_SONG_ID, { label: 'Acceptance Chorus 2' });
    // Trumpet only ever gets "Intro" calibrated — "Chorus 2" stays unknown to it.
    setVoiceAnchorPosition(setup.doc, trumpetVoiceId, introAnchorId, { fileIndex: 0, page: 1, yPct: 0 });
    setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, introAnchorId, { fileIndex: 0, page: 1, yPct: 0 });
    setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, chorusAnchorId, { fileIndex: 0, page: 2, yPct: 0 });
    setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, aliceUserId, fullScoreVoiceId);
    setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, bobUserId, trumpetVoiceId);
    await flush();

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    try {
      await login(alice, DEMO_OWNER_EMAIL);
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoStageForSong(alice, bandId, 'Full Band Practice Set', 'Amazing Grace');
      await gotoStageForSong(bob, bandId, 'Full Band Practice Set', 'Amazing Grace');

      await bob.getByRole('button', { name: 'Follow' }).click();
      await bob.getByRole('button', { name: /^Alice/ }).click();

      await alice.getByRole('button', { name: 'Next' }).first().click(); // page 1 -> page 2, "Acceptance Chorus 2" — unknown to Bob's Trumpet
      await expect(bob.getByText('Jumped to the nearest known anchor (Acceptance Intro)')).toBeVisible({ timeout: 5000 });
    } finally {
      await leaveStageMode(alice).catch(() => {});
      await leaveStageMode(bob).catch(() => {});
      await aliceContext.close();
      await bobContext.close();
      setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, aliceUserId, getDefaultVoiceId(AMAZING_GRACE_SONG_ID));
      setAssignment(setup.doc, AMAZING_GRACE_SONG_ID, bobUserId, getDefaultVoiceId(AMAZING_GRACE_SONG_ID));
      await flush();
      setup.provider.destroy();
    }
  });

  test('no anchors, identical file: page-sync keeps a follower on the same page', async ({ browser }) => {
    const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
    const [aliceUserId, bobUserId] = await Promise.all([
      withDb((c) => getUserIdByEmail(c, DEMO_OWNER_EMAIL)),
      withDb((c) => getUserIdByEmail(c, DEMO_MEMBER_EMAIL)),
    ]);
    const setup = await connectSetupDoc(bandId);
    const fullScoreFiles = listVoicesForSong(setup.doc, AMAZING_GRACE_SONG_ID).find((v) => v.voice.name === 'Full Score')!
      .voice as { files: NonNullable<unknown> };

    const songTitle = `Page Sync Test ${Date.now()}`;
    const songId = addSong(setup.doc, {
      title: songTitle,
      artist: 'Acceptance Suite',
      key: 'C',
      bpm: 100,
      durationSec: 60,
      status: 'active',
      body: '{title: Page Sync Test}\n{start_of_verse}\n[C]placeholder[C]\n{end_of_verse}',
    });
    // Same file (content-addressed, already uploaded for Amazing Grace) —
    // reused here, never re-uploaded, so two voices genuinely share a sha256.
    const sharedVoiceId = createVoice(setup.doc, songId, {
      name: 'Shared PDF',
      kind: 'files',
      files: (fullScoreFiles as { files: { sha256: string; filename: string; mime: string; pageCount: number }[] }).files,
    });
    setAssignment(setup.doc, songId, aliceUserId, sharedVoiceId);
    setAssignment(setup.doc, songId, bobUserId, sharedVoiceId);
    const setlistId = await withDb((client) => getSetlistIdByName(client, bandId, 'Open Mic Night'));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
    await flush();

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    try {
      await login(alice, DEMO_OWNER_EMAIL);
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoStageForSong(alice, bandId, 'Open Mic Night', songTitle);
      await gotoStageForSong(bob, bandId, 'Open Mic Night', songTitle);

      await bob.getByRole('button', { name: 'Follow' }).click();
      await bob.getByRole('button', { name: /^Alice/ }).click();
      await expect(bob.getByTestId('sync-level-indicator')).toHaveText('Page sync');

      await alice.getByRole('button', { name: 'Next' }).first().click();
      await expect(bob.getByText('Page 2 of 2')).toBeVisible({ timeout: 5000 });
    } finally {
      await leaveStageMode(alice).catch(() => {});
      await leaveStageMode(bob).catch(() => {});
      await aliceContext.close();
      await bobContext.close();
      setup.provider.destroy();
    }
  });

  test('no anchors, different voices: only the song is synced, each device pages for itself', async ({ browser }) => {
    const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
    const [aliceUserId, bobUserId] = await Promise.all([
      withDb((c) => getUserIdByEmail(c, DEMO_OWNER_EMAIL)),
      withDb((c) => getUserIdByEmail(c, DEMO_MEMBER_EMAIL)),
    ]);
    const setup = await connectSetupDoc(bandId);
    const fullScoreVoice = listVoicesForSong(setup.doc, AMAZING_GRACE_SONG_ID).find((v) => v.voice.name === 'Full Score')!
      .voice as { files: { sha256: string; filename: string; mime: string; pageCount: number }[] };

    const songTitle = `Song Only Sync Test ${Date.now()}`;
    const songId = addSong(setup.doc, {
      title: songTitle,
      artist: 'Acceptance Suite',
      key: 'C',
      bpm: 100,
      durationSec: 60,
      status: 'active',
      body: '{title: Song Only Sync Test}\n{start_of_verse}\n[C]chordpro follower content[C]\n{end_of_verse}',
    });
    const filesVoiceId = createVoice(setup.doc, songId, { name: 'PDF voice', kind: 'files', files: fullScoreVoice.files });
    const chordproVoiceId = getDefaultVoiceId(songId);
    setAssignment(setup.doc, songId, aliceUserId, filesVoiceId);
    setAssignment(setup.doc, songId, bobUserId, chordproVoiceId);
    const setlistId = await withDb((client) => getSetlistIdByName(client, bandId, 'Open Mic Night'));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
    await flush();

    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    try {
      await login(alice, DEMO_OWNER_EMAIL);
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoStageForSong(alice, bandId, 'Open Mic Night', songTitle);
      await gotoStageForSong(bob, bandId, 'Open Mic Night', songTitle);

      await bob.getByRole('button', { name: 'Follow' }).click();
      await bob.getByRole('button', { name: /^Alice/ }).click();
      await expect(bob.getByTestId('sync-level-indicator')).toHaveText('Song only');

      const bobScrollBefore = await bob.evaluate(() => document.querySelector('.stage-item-transition')?.scrollTop ?? -1);
      await alice.getByRole('button', { name: 'Next' }).first().click();
      await alice.waitForTimeout(1000);
      // Following still mirrors the *item* at every level — only the
      // within-item position is skipped at this fallback level. Bob's own
      // item shouldn't have changed either, since Alice's PDF only has one
      // page to move to/from within this same item.
      await expect(stageModeHeading(bob)).toHaveText(await stageModeHeading(alice).textContent().then((t) => t ?? ''));
      const bobScrollAfter = await bob.evaluate(() => document.querySelector('.stage-item-transition')?.scrollTop ?? -1);
      expect(bobScrollAfter).toBe(bobScrollBefore);
    } finally {
      await leaveStageMode(alice).catch(() => {});
      await leaveStageMode(bob).catch(() => {});
      await aliceContext.close();
      await bobContext.close();
      setup.provider.destroy();
    }
  });

  test('going offline in Stage Mode never blocks playing, and the sync indicator recovers once back online', async ({
    browser,
  }) => {
    const bandId = await withDb((client) => getBandIdBySlug(client, 'demo-band'));
    const bobContext = await browser.newContext();
    const bob = await bobContext.newPage();
    try {
      await login(bob, DEMO_MEMBER_EMAIL);
      await gotoStageForSong(bob, bandId, 'Full Band Practice Set', 'Amazing Grace');
      const startTitle = await stageModeHeading(bob).textContent();

      await bobContext.setOffline(true);
      await expect(bob.getByText('Offline')).toBeVisible({ timeout: 10000 });

      await bob.getByRole('button', { name: 'Next' }).click();
      const offlineTitle = await stageModeHeading(bob).textContent();
      expect(offlineTitle).not.toBe(startTitle);

      await bobContext.setOffline(false);
      await expect(bob.getByText('Offline')).toBeHidden({ timeout: 10000 });
    } finally {
      await leaveStageMode(bob).catch(() => {});
      await bobContext.close();
    }
  });
});
