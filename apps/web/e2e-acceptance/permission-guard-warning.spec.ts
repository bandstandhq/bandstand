// SPDX-License-Identifier: Apache-2.0
//
// Issue #48: a client-originated attempt to permanently delete a song
// (bypassing REST) is reverted server-side (hocuspocus.ts's onChange guard,
// see hocuspocus.integration.test.ts for that half) — this proves the other
// half, that the band's owner actually sees it happen in Band Settings, and
// can dismiss it once seen.
import { expect, test } from '@playwright/test';
import {
  createThrowawayBand,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  deleteTestAccount,
  deleteThrowawayBand,
  freshEmail,
  freshName,
  login,
} from './fixtures';
import { connectTestBandDoc, signInForToken, signUpForToken } from './hocuspocusTestClient';
import { addBandMember, withDb } from './testDb';
import { addSong } from '@bandstand/core';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('an unauthorized delete attempt reverted by the server shows up as a dismissible warning in Band Settings', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'guard-warning');

  const memberEmail = freshEmail('guard-warning-member');
  const { userId: memberUserId, token: memberToken } = await signUpForToken(
    freshName('guard-warning-member'),
    memberEmail,
    DEMO_PASSWORD,
  );

  try {
    await withDb((client) => addBandMember(client, bandId, memberUserId));

    const setup = connectTestBandDoc(bandId, memberToken);
    await setup.waitForSynced();
    const songId = addSong(setup.doc, {
      title: 'Guard Warning Fixture',
      artist: 'Acceptance Suite',
      key: 'C',
      bpm: 100,
      durationSec: 180,
      status: 'active',
      body: '{title: Guard Warning Fixture}',
    });
    await flush();

    // The attack: delete the song directly over the live CRDT connection,
    // no REST call — exactly the bypass the guard exists to catch.
    setup.doc.getMap('songs').delete(songId);
    await flush();
    setup.provider.destroy();

    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);

    const warning = page.getByText(/tried to permanently delete a song/i);
    await expect(warning).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(warning).not.toBeVisible();

    // Dismissing must actually persist server-side, not just hide it
    // client-side until the next reload.
    await page.reload();
    await expect(page.getByText(/tried to permanently delete a song/i)).not.toBeVisible();
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    await deleteTestAccount(memberEmail);
  }
});
