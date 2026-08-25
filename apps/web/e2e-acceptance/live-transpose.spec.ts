// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, enterStageMode, getActiveBandId, login } from './fixtures';

test('a live transpose during Stage Mode never persists past the session', async ({ page }) => {
  await login(page, DEMO_OWNER_EMAIL);
  const bandId = await getActiveBandId(page);

  await enterStageMode(page, bandId, 'Open Mic Night', 0);
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
  await page.locator('.border-dashed li a').first().click();
  await page.waitForURL(/\/stage\//);
  await expect(page.getByText(/^Key /)).toHaveText(originalKeyText ?? '');
});
