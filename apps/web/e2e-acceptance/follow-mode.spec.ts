// SPDX-License-Identifier: Apache-2.0
import { addSetlistItem, addSong, buildSongItem, createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_MEMBER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  enterStageMode,
  login,
  stageModeHeading,
} from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { addBandMember, getUserIdByEmail, withDb } from './testDb';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

function songFixture(title: string) {
  return {
    title,
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 60,
    status: 'active' as const,
    body: `{title: ${title}}\n{start_of_verse}\n[C]la la la[C]\n{end_of_verse}`,
  };
}

test('follow mode mirrors the leader\'s position within a second, until a manual scroll pauses it', async ({
  browser,
}) => {
  const aliceToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(aliceToken, 'follow-mode');
  await withDb(async (client) => {
    const bobUserId = await getUserIdByEmail(client, DEMO_MEMBER_EMAIL);
    await addBandMember(client, bandId, bobUserId);
  });

  const setup = connectTestBandDoc(bandId, aliceToken);
  await setup.waitForSynced();
  const setlistName = 'Follow Mode Test';
  const setlistId = createSetlist(setup.doc, setlistName);
  for (const title of ['Follow Song One', 'Follow Song Two', 'Follow Song Three']) {
    const songId = addSong(setup.doc, songFixture(title));
    addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  }
  await flush();

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await login(alice, DEMO_OWNER_EMAIL);
    await login(bob, DEMO_MEMBER_EMAIL);

    // Alice starts on the first item, Bob on the second — distinct enough
    // that following/mirroring is actually observable, not a no-op.
    await enterStageMode(alice, bandId, setlistName, 0);
    await enterStageMode(bob, bandId, setlistName, 1);
    const aliceStartTitle = await stageModeHeading(alice).textContent();

    await bob.getByRole('button', { name: 'Follow' }).click();
    await bob.getByRole('button', { name: /^Alice/ }).click();
    await expect(stageModeHeading(bob)).toHaveText(aliceStartTitle ?? '', { timeout: 1000 });

    // The leader moves — the follower mirrors it within a second, with no
    // action of their own.
    await alice.getByRole('button', { name: 'Next' }).click();
    const aliceNextTitle = await stageModeHeading(alice).textContent();
    expect(aliceNextTitle).not.toBe(aliceStartTitle);
    await expect(stageModeHeading(bob)).toHaveText(aliceNextTitle ?? '', { timeout: 1000 });

    // Bob scrolling manually pauses following — his view stops tracking
    // Alice, and a "Back to Alice" resume control appears.
    const bobContentArea = bob.locator('.stage-item-transition');
    await bobContentArea.hover();
    await bob.mouse.wheel(0, 200);
    await expect(bob.getByRole('button', { name: /^Back to Alice/ })).toBeVisible();

    await alice.getByRole('button', { name: 'Next' }).click();
    const aliceThirdTitle = await stageModeHeading(alice).textContent();
    // Give it a real beat to (not) arrive — the point is it must not.
    await bob.waitForTimeout(1000);
    await expect(stageModeHeading(bob)).not.toHaveText(aliceThirdTitle ?? '');

    // Resuming picks the leader's *current* position back up.
    await bob.getByRole('button', { name: /^Back to Alice/ }).click();
    await expect(stageModeHeading(bob)).toHaveText(aliceThirdTitle ?? '', { timeout: 1000 });
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await deleteThrowawayBand(aliceToken, bandId);
    setup.provider.destroy();
  }
});
