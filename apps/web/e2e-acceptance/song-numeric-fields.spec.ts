// SPDX-License-Identifier: Apache-2.0
//
// BPM and duration used to be a single, unbounded "seconds" number field —
// no upper bound on BPM, no way to enter duration as minutes:seconds, and
// no numeric keypad hint on phones. Regression coverage for the clamping
// (BPM 20-400) and the minutes+seconds duration split.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('BPM clamps to 20-400, and duration is entered as minutes and seconds', async ({ page }) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'song-numeric');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/new`);

    // Numeric fields bring up a phone's digit keypad, not the full keyboard.
    await expect(page.getByLabel('BPM')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByLabel('Minutes')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByLabel('Seconds')).toHaveAttribute('inputmode', 'numeric');

    await page.getByLabel('Title').fill('Numeric Fields Song');
    await page.getByLabel('Artist').fill('Test Artist');

    // A wildly high BPM clamps to the top of the range rather than resetting
    // to a default, and duration is split as 3 min 45 sec, not 225 sec.
    // Saving a new song lands directly on its own edit page.
    await page.getByLabel('BPM').fill('9000');
    await page.getByLabel('Minutes').fill('3');
    await page.getByLabel('Seconds').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('BPM')).toHaveValue('400');
    await expect(page.getByLabel('Minutes')).toHaveValue('3');
    await expect(page.getByLabel('Seconds')).toHaveValue('45');

    // A BPM below the floor clamps up instead of resetting to the default either.
    await page.getByLabel('BPM').fill('1');
    await page.getByLabel('Seconds').fill('5');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/repertoire$/);

    await page.getByRole('link', { name: /Edit Numeric Fields Song/i }).click();
    await page.waitForURL(/\/edit$/);
    await expect(page.getByLabel('BPM')).toHaveValue('20');
    await expect(page.getByLabel('Minutes')).toHaveValue('3');
    await expect(page.getByLabel('Seconds')).toHaveValue('5');
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
