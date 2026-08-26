// SPDX-License-Identifier: Apache-2.0
import { addSong } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteThrowawayBand,
  freshEmail,
  login,
  signUp,
} from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a non-member never sees a band doc\'s content, even navigating straight to its URL', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'non-member-access');
  const setup = connectTestBandDoc(bandId, token);
  await setup.waitForSynced();
  const songTitle = 'Non-Member Access Fixture Song';
  addSong(setup.doc, {
    title: songTitle,
    artist: 'Acceptance Suite',
    key: 'C',
    bpm: 100,
    durationSec: 60,
    status: 'active',
    body: `{title: ${songTitle}}\n{start_of_verse}\n[C]la[C]\n{end_of_verse}`,
  });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    // Visits the band's content once as its owner, so this browser
    // profile's IndexedDB actually caches it — the exact scenario this test
    // guards against.
    await page.goto(`/bands/${bandId}/repertoire`);
    await expect(page.getByText(songTitle)).toBeVisible();
    // The "Log out" control only lives on the dashboard.
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/login/);

    await page.goto('/signup');
    await signUp(page, { name: 'Eve (outsider)', email: freshEmail('eve') });
    await page.waitForURL(/\/dashboard$/);

    // Alice's earlier session cached the full band doc in this browser
    // profile's IndexedDB (keyed, before the fix, by bandId alone) — a
    // non-member reusing that profile must never see it, not even from
    // local cache while the (correctly rejected) Hocuspocus connection is
    // still settling. See docs/adr/0006-offline-cache-scoping.md.
    await page.goto(`/bands/${bandId}/repertoire`);
    await expect(
      page.getByText("You're not a member of this band, so its content isn't available here."),
    ).toBeVisible();
    await expect(page.getByText(songTitle)).not.toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByText(songTitle)).not.toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
    setup.provider.destroy();
  }
});
