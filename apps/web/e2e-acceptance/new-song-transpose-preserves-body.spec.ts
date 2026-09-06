// SPDX-License-Identifier: Apache-2.0
//
// Regression test for issue #233: transposing a brand-new, unsaved song
// discarded its typed ChordPro body instead of transposing it.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('transposing a new, unsaved song keeps its typed lyrics/chords instead of discarding them', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'new-song-transpose');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/new`);

    await page.getByLabel('Title').fill('Untitled Draft');
    await page.getByLabel('Artist').fill('Draft Artist');
    await page.getByLabel('ChordPro').fill('{key: C}\n[C]Hello [G]world');

    await page.getByRole('button', { name: '+1' }).click();

    await expect(page.getByLabel('ChordPro')).toHaveValue('{key: C#}\n[C#]Hello [G#]world');
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
