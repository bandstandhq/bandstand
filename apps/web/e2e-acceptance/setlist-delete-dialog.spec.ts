// SPDX-License-Identifier: Apache-2.0
//
// Representative coverage for the generic ConfirmDialog/useConfirmDialog
// replacement of window.confirm — proves the mechanism works end to end
// outside EventDetail.tsx (which has its own dedicated coverage), for one
// of the ten other call sites that switched to it the same way.
import { createSetlist } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, freshName, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('deleting a setlist goes through the styled confirm dialog, not a native confirm', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'setlist-delete-dialog');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const setlistName = freshName('Setlist To Delete');
  createSetlist(setup.doc, setlistName);
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/setlists`);
    await expect(page.getByText(setlistName)).toBeVisible();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(setlistName)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText(setlistName)).toHaveCount(0);
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
