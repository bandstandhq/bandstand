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
//
// Each test owns a fresh throwaway band (see fixtures.ts's
// createThrowawayBand/deleteThrowawayBand) and uploads its own PDF fixture
// via the real presign-upload/confirm flow (fileUploadTestClient.ts) — a
// band's content-addressed attachment ledger is per-band (ADR-0007), so
// reusing demo-band's already-uploaded Amazing Grace PDFs wouldn't work for
// a different band even if the bytes are identical. No acceptance test
// reads or writes demo-band/second-fiddle's own content (issue #81).
import { fileURLToPath } from 'node:url';
import {
  addSetlistItem,
  addSong,
  buildSongItem,
  createAnchor,
  createSetlist,
  createVoice,
  getDefaultVoiceId,
  setAssignment,
  setVoiceAnchorPosition,
  setVoiceDisplayRecipe,
  updateVoiceBody,
} from '@bandstand/core';
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  login,
  stageModeHeading,
} from './fixtures';
import { uploadFileToBand } from './fileUploadTestClient';
import { connectTestBandDoc, signInForToken, type TestBandDoc } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

const ASSETS_DIR = fileURLToPath(new URL('../../server/src/seed/assets', import.meta.url));
const FULL_SCORE_PDF = `${ASSETS_DIR}/amazing-grace-full-score.pdf`;
const TRUMPET_PDF = `${ASSETS_DIR}/amazing-grace-trumpet.pdf`;

/** Real Yjs writes go out over an open WebSocket as soon as they're made, but destroying the provider right after gives them no chance to actually leave — a short pause first is cheap insurance. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

async function setupThrowawayBandWithBob(namePrefix: string) {
  const aliceToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(aliceToken, namePrefix);
  const [aliceUserId, bobUserId] = await withDb(async (client) => {
    const alice = await getUserIdByEmail(client, DEMO_OWNER_EMAIL);
    const bob = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bob);
    return [alice, bob];
  });
  const setup = connectTestBandDoc(bandId, aliceToken);
  await setup.waitForSynced();
  return { aliceToken, bandId, aliceUserId, bobUserId, setup };
}

/** A song with a default ChordPro voice plus real "Full Score" and "Trumpet in B♭" files-voices, uploaded into this band via the real client-facing REST flow. */
async function createSongWithBothVoices(aliceToken: string, bandId: string, setup: TestBandDoc) {
  const songTitle = 'Anchor Sync Fixture Song';
  const songId = addSong(setup.doc, {
    title: songTitle,
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 180,
    status: 'active',
    body: `{title: ${songTitle}}\n{start_of_verse}\n[C]Verse content[C]\n{end_of_verse}`,
  });
  const defaultVoiceId = getDefaultVoiceId(songId);

  const fullScoreFile = await uploadFileToBand(aliceToken, bandId, FULL_SCORE_PDF, 'amazing-grace-full-score.pdf', 'application/pdf');
  const fullScoreVoiceId = createVoice(setup.doc, songId, {
    name: 'Full Score',
    kind: 'files',
    files: [{ ...fullScoreFile, pageCount: 2 }],
  });

  const trumpetFile = await uploadFileToBand(aliceToken, bandId, TRUMPET_PDF, 'amazing-grace-trumpet.pdf', 'application/pdf');
  const trumpetVoiceId = createVoice(setup.doc, songId, {
    name: 'Trumpet in B♭',
    kind: 'files',
    instrument: 'Trumpet',
    files: [{ ...trumpetFile, pageCount: 1 }],
  });

  const setlistName = 'Anchor Sync Test';
  const setlistId = createSetlist(setup.doc, setlistName);
  addSetlistItem(setup.doc, setlistId, buildSongItem(songId));

  return { songId, songTitle, defaultVoiceId, fullScoreVoiceId, trumpetVoiceId, setlistName };
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
  // The row itself is now also a (stretched, invisible) link to the same
  // destination, with its own accessible name ("Open <setlist name>") — an
  // exact match on the small visible "Open" link keeps this from matching
  // both.
  await page.locator('li', { hasText: setlistName }).getByRole('link', { name: 'Open', exact: true }).click();
  const matchingLink = page.locator('a', { hasText: songTitle }).first();
  await matchingLink.waitFor({ state: 'visible', timeout: 15000 });
  await matchingLink.click();
  await page.waitForURL(/\/stage\//);
}

test.describe('anchor-based Stage Mode sync (docs/adr/0010-anchor-sync.md)', () => {
  test('different voices, different content: jumping to an anchor lands each device at its own calibrated position', async ({
    browser,
  }) => {
    const { aliceToken, bandId, aliceUserId, bobUserId, setup } = await setupThrowawayBandWithBob('anchor-sync-jump');
    try {
      const { songId, songTitle, defaultVoiceId, fullScoreVoiceId, setlistName } = await createSongWithBothVoices(
        aliceToken,
        bandId,
        setup,
      );

      const anchorId = createAnchor(setup.doc, songId, { label: 'Acceptance Chorus' });
      const chordProVoice = setup.doc.getMap('voices').get(defaultVoiceId) as { body: string };
      updateVoiceBody(
        setup.doc,
        defaultVoiceId,
        `${chordProVoice.body}\n\n{start_of_chorus: label="Acceptance Chorus"}\n[G]Chorus marker for acceptance testing[G]\n{end_of_chorus}`,
      );
      setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, anchorId, { fileIndex: 0, page: 2, yPct: 0 });
      setAssignment(setup.doc, songId, aliceUserId, fullScoreVoiceId);
      setAssignment(setup.doc, songId, bobUserId, defaultVoiceId);
      await flush();

      const aliceContext = await browser.newContext();
      const bobContext = await browser.newContext();
      const alice = await aliceContext.newPage();
      const bob = await bobContext.newPage();
      try {
        await login(alice, DEMO_OWNER_EMAIL);
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(alice, bandId, setlistName, songTitle);
        await gotoStageForSong(bob, bandId, setlistName, songTitle);

        await bob.getByRole('button', { name: 'Follow' }).click();
        await bob.getByRole('button', { name: /^Alice/ }).click();

        // Alice's Full Score is on page 1; page 2 is calibrated to "Acceptance Chorus".
        await alice.getByRole('button', { name: 'Next' }).first().click();
        await expect(bob.getByText('Chorus marker for acceptance testing').first()).toBeInViewport({ timeout: 5000 });
      } finally {
        await aliceContext.close();
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });

  test('a calibrated anchor still lands on the correct page after the follower\'s own voice is reordered', async ({
    browser,
  }) => {
    const { aliceToken, bandId, aliceUserId, bobUserId, setup } = await setupThrowawayBandWithBob('anchor-sync-reorder');
    try {
      const fullScoreFile = await uploadFileToBand(
        aliceToken,
        bandId,
        FULL_SCORE_PDF,
        'amazing-grace-full-score.pdf',
        'application/pdf',
      );
      const files = [{ ...fullScoreFile, pageCount: 2 }];

      const songTitle = `Reorder Test ${Date.now()}`;
      const songId = addSong(setup.doc, {
        title: songTitle,
        artist: 'Acceptance Suite',
        key: 'C',
        bpm: 100,
        durationSec: 60,
        status: 'active',
        body: '{title: Reorder Test}\n{start_of_verse}\n[C]placeholder[C]\n{end_of_verse}',
      });
      // Two independent voices over the same two-page file: the leader's
      // copy stays in natural order, the follower's copy has its pages
      // swapped — proving the anchor jump resolves against *the follower's
      // own* display recipe, not the leader's, and not the raw source page
      // number (see findRenderedPositionForSourcePage in packages/core).
      const leaderVoiceId = createVoice(setup.doc, songId, { name: 'Leader Score', kind: 'files', files });
      const followerVoiceId = createVoice(setup.doc, songId, { name: 'Follower Score', kind: 'files', files });

      const anchorId = createAnchor(setup.doc, songId, { label: 'Reorder Chorus' });
      // Source page 2 (fileIndex 0, page 2) is calibrated on both copies —
      // same underlying position, addressed the same way regardless of how
      // each voice's pages are currently displayed.
      setVoiceAnchorPosition(setup.doc, leaderVoiceId, anchorId, { fileIndex: 0, page: 2, yPct: 0 });
      setVoiceAnchorPosition(setup.doc, followerVoiceId, anchorId, { fileIndex: 0, page: 2, yPct: 0 });
      // Follower's pages reversed: source page 2 (originalIndex 1) now
      // renders at position 0, source page 1 at position 1 — the opposite
      // of where they'd naturally fall.
      setVoiceDisplayRecipe(setup.doc, followerVoiceId, { pageOrder: [1, 0] });

      setAssignment(setup.doc, songId, aliceUserId, leaderVoiceId);
      setAssignment(setup.doc, songId, bobUserId, followerVoiceId);

      const setlistName = 'Reorder Test Setlist';
      const setlistId = createSetlist(setup.doc, setlistName);
      addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
      await flush();

      const aliceContext = await browser.newContext();
      const bobContext = await browser.newContext();
      const alice = await aliceContext.newPage();
      const bob = await bobContext.newPage();
      try {
        await login(alice, DEMO_OWNER_EMAIL);
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(alice, bandId, setlistName, songTitle);
        await gotoStageForSong(bob, bandId, setlistName, songTitle);
        // The PDF viewer's own Next/Prev row only mounts once the file has
        // loaded — until then, the only "Next" in the accessible tree is the
        // (always-disabled, single-item setlist) chrome one below it, and
        // `.first()` would latch onto that instead. Waiting for the page
        // indicator first avoids racing PDF load on a loaded machine.
        await expect(bob.getByText('Page 1 of 2')).toBeVisible({ timeout: 15000 });

        // Bob moves to his own position 1 (source page 1, under the
        // reversed recipe) before following — establishes a starting point
        // distinct from where the anchor jump should land him, so the
        // later assertion actually proves the jump moved him there.
        await bob.getByRole('button', { name: 'Next' }).first().click();
        await expect(bob.getByText('Page 2 of 2')).toBeVisible();

        await bob.getByRole('button', { name: 'Follow' }).click();
        await bob.getByRole('button', { name: /^Alice/ }).click();

        // Alice's own (naturally-ordered) copy: page 1 -> page 2, which is
        // where "Reorder Chorus" is calibrated on her side too.
        await alice.getByRole('button', { name: 'Next' }).first().click();

        // The anchor is source page 2 — on Bob's reversed recipe that's
        // rendered position 0, i.e. "Page 1 of 2", not "Page 2 of 2".
        await expect(bob.getByText('Page 1 of 2')).toBeVisible({ timeout: 5000 });
      } finally {
        await aliceContext.close();
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });

  test('an anchor unknown to the follower\'s voice walks back to the nearest known one, with a hint', async ({ browser }) => {
    const { aliceToken, bandId, aliceUserId, bobUserId, setup } = await setupThrowawayBandWithBob('anchor-sync-walkback');
    try {
      const { songId, songTitle, fullScoreVoiceId, trumpetVoiceId, setlistName } = await createSongWithBothVoices(
        aliceToken,
        bandId,
        setup,
      );

      const introAnchorId = createAnchor(setup.doc, songId, { label: 'Acceptance Intro' });
      const chorusAnchorId = createAnchor(setup.doc, songId, { label: 'Acceptance Chorus 2' });
      // Trumpet only ever gets "Intro" calibrated — "Chorus 2" stays unknown to it.
      setVoiceAnchorPosition(setup.doc, trumpetVoiceId, introAnchorId, { fileIndex: 0, page: 1, yPct: 0 });
      setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, introAnchorId, { fileIndex: 0, page: 1, yPct: 0 });
      setVoiceAnchorPosition(setup.doc, fullScoreVoiceId, chorusAnchorId, { fileIndex: 0, page: 2, yPct: 0 });
      setAssignment(setup.doc, songId, aliceUserId, fullScoreVoiceId);
      setAssignment(setup.doc, songId, bobUserId, trumpetVoiceId);
      await flush();

      const aliceContext = await browser.newContext();
      const bobContext = await browser.newContext();
      const alice = await aliceContext.newPage();
      const bob = await bobContext.newPage();
      try {
        await login(alice, DEMO_OWNER_EMAIL);
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(alice, bandId, setlistName, songTitle);
        await gotoStageForSong(bob, bandId, setlistName, songTitle);

        await bob.getByRole('button', { name: 'Follow' }).click();
        await bob.getByRole('button', { name: /^Alice/ }).click();

        await alice.getByRole('button', { name: 'Next' }).first().click(); // page 1 -> page 2, "Acceptance Chorus 2" — unknown to Bob's Trumpet
        await expect(bob.getByText('Jumped to the nearest known anchor (Acceptance Intro)')).toBeVisible({ timeout: 5000 });
      } finally {
        await aliceContext.close();
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });

  test('no anchors, identical file: page-sync keeps a follower on the same page', async ({ browser }) => {
    const { aliceToken, bandId, aliceUserId, bobUserId, setup } = await setupThrowawayBandWithBob('anchor-sync-page');
    try {
      const fullScoreFile = await uploadFileToBand(
        aliceToken,
        bandId,
        FULL_SCORE_PDF,
        'amazing-grace-full-score.pdf',
        'application/pdf',
      );
      const files = [{ ...fullScoreFile, pageCount: 2 }];

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
      const sharedVoiceId = createVoice(setup.doc, songId, { name: 'Shared PDF', kind: 'files', files });
      setAssignment(setup.doc, songId, aliceUserId, sharedVoiceId);
      setAssignment(setup.doc, songId, bobUserId, sharedVoiceId);
      const setlistName = 'Page Sync Setlist';
      const setlistId = createSetlist(setup.doc, setlistName);
      addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
      await flush();

      const aliceContext = await browser.newContext();
      const bobContext = await browser.newContext();
      const alice = await aliceContext.newPage();
      const bob = await bobContext.newPage();
      try {
        await login(alice, DEMO_OWNER_EMAIL);
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(alice, bandId, setlistName, songTitle);
        await gotoStageForSong(bob, bandId, setlistName, songTitle);

        await bob.getByRole('button', { name: 'Follow' }).click();
        await bob.getByRole('button', { name: /^Alice/ }).click();
        await expect(bob.getByTestId('sync-level-indicator')).toHaveText('Page sync');

        await alice.getByRole('button', { name: 'Next' }).first().click();
        await expect(bob.getByText('Page 2 of 2')).toBeVisible({ timeout: 5000 });
      } finally {
        await aliceContext.close();
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });

  test('no anchors, different voices: only the song is synced, each device pages for itself', async ({ browser }) => {
    const { aliceToken, bandId, aliceUserId, bobUserId, setup } = await setupThrowawayBandWithBob('anchor-sync-songonly');
    try {
      const fullScoreFile = await uploadFileToBand(
        aliceToken,
        bandId,
        FULL_SCORE_PDF,
        'amazing-grace-full-score.pdf',
        'application/pdf',
      );

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
      const filesVoiceId = createVoice(setup.doc, songId, {
        name: 'PDF voice',
        kind: 'files',
        files: [{ ...fullScoreFile, pageCount: 2 }],
      });
      const chordproVoiceId = getDefaultVoiceId(songId);
      setAssignment(setup.doc, songId, aliceUserId, filesVoiceId);
      setAssignment(setup.doc, songId, bobUserId, chordproVoiceId);
      const setlistName = 'Song Only Sync Setlist';
      const setlistId = createSetlist(setup.doc, setlistName);
      addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
      await flush();

      const aliceContext = await browser.newContext();
      const bobContext = await browser.newContext();
      const alice = await aliceContext.newPage();
      const bob = await bobContext.newPage();
      try {
        await login(alice, DEMO_OWNER_EMAIL);
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(alice, bandId, setlistName, songTitle);
        await gotoStageForSong(bob, bandId, setlistName, songTitle);

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
        await aliceContext.close();
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });

  test('going offline in Stage Mode never blocks playing, and the sync indicator recovers once back online', async ({
    browser,
  }) => {
    const { aliceToken, bandId, setup } = await setupThrowawayBandWithBob('anchor-sync-offline');
    try {
      const setlistName = 'Offline Stage Test';
      const setlistId = createSetlist(setup.doc, setlistName);
      // Not "Offline ..." — that substring is also what the sync-level
      // indicator itself shows once actually offline, and a title
      // containing it would make `getByText('Offline')` match two elements.
      for (const title of ['Solo Song One', 'Solo Song Two']) {
        const songId = addSong(setup.doc, {
          title,
          artist: 'Acceptance Suite',
          key: 'C',
          bpm: 100,
          durationSec: 60,
          status: 'active',
          body: `{title: ${title}}\n{start_of_verse}\n[C]la[C]\n{end_of_verse}`,
        });
        addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
      }
      await flush();

      const bobContext = await browser.newContext();
      const bob = await bobContext.newPage();
      try {
        await login(bob, DEMO_MEMBER_EMAIL);
        await gotoStageForSong(bob, bandId, setlistName, 'Solo Song One');
        const startTitle = await stageModeHeading(bob).textContent();

        await bobContext.setOffline(true);
        await expect(bob.getByText('Offline')).toBeVisible({ timeout: 10000 });

        await bob.getByRole('button', { name: 'Next' }).click();
        const offlineTitle = await stageModeHeading(bob).textContent();
        expect(offlineTitle).not.toBe(startTitle);

        await bobContext.setOffline(false);
        await expect(bob.getByText('Offline')).toBeHidden({ timeout: 10000 });
      } finally {
        await bobContext.close();
      }
    } finally {
      await deleteThrowawayBand(aliceToken, bandId);
      setup.provider.destroy();
    }
  });
});
