// SPDX-License-Identifier: Apache-2.0
import { addSetlistItem, addSong, buildSongItem, createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  enterStageMode,
  login,
} from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a live transpose during Stage Mode never persists past the session', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'live-transpose');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();

  const setlistName = 'Live Transpose Test';
  const songId = addSong(setup.doc, {
    title: 'Transpose Fixture',
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 60,
    status: 'active',
    body: '{title: Transpose Fixture}\n{start_of_verse}\n[C]La la la[C]\n{end_of_verse}',
  });
  const setlistId = createSetlist(setup.doc, setlistName);
  addSetlistItem(setup.doc, setlistId, buildSongItem(songId));
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await enterStageMode(page, bandId, setlistName, 0);
    const keyBadge = page.getByText(/^Key /);
    const originalKeyText = await keyBadge.textContent();

    await page.getByRole('button', { name: 'Transpose up' }).click();
    await page.getByRole('button', { name: 'Transpose up' }).click();
    await expect(keyBadge).toHaveText(/\(\+2\)/);
    const transposedKeyText = await keyBadge.textContent();
    expect(transposedKeyText).not.toBe(originalKeyText);

    // Leaving and re-entering Stage Mode starts a fresh session — the
    // transpose was only ever broadcast over Awareness, never written to the
    // song, so it doesn't carry over.
    await page.getByRole('button', { name: 'Exit' }).click();
    await page.waitForURL(/\/setlists\//);
    // The setlist opens in its calm read view by default — each item's whole
    // row is a link straight into Stage Mode.
    await page.locator('main a[href*="/stage/"]').first().click();
    await page.waitForURL(/\/stage\//);
    await expect(page.getByText(/^Key /)).toHaveText(originalKeyText ?? '');
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
