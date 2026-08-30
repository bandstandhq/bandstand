// SPDX-License-Identifier: Apache-2.0
import { addSong } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, freshEmail, signUp } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';
import { addBandMember, deleteUserByEmail, getUserIdByEmail, removeBandMember, withDb } from './testDb';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a removed member\'s cached band content clears on the next reconnect', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'removed-member');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();
  const songTitle = 'Removed Member Fixture Song';
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

  const email = freshEmail('temp-member');
  try {
    await page.goto('/signup');
    await signUp(page, { name: 'Temp Member', email });
    await page.waitForURL(/\/dashboard$/);

    await withDb(async (client) => {
      const userId = await getUserIdByEmail(client, email);
      await addBandMember(client, bandId, userId);
    });

    // A real, currently-valid membership: confirm content actually loads
    // (and gets cached locally) before revoking it.
    await page.goto(`/bands/${bandId}/repertoire`);
    await expect(page.getByText(songTitle)).toBeVisible();

    await withDb(async (client) => {
      const userId = await getUserIdByEmail(client, email);
      await removeBandMember(client, bandId, userId);
    });

    // Reload forces a brand-new Hocuspocus connection attempt (and a fresh
    // REST membership check) — both must now say "not a member", and the
    // previously-cached content must not survive that.
    await page.reload();
    await expect(page.getByText(songTitle)).not.toBeVisible();
    await expect(page.getByText("You're not a member of this band, so its content isn't available here.")).toBeVisible();
  } finally {
    await withDb((client) => deleteUserByEmail(client, email));
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
