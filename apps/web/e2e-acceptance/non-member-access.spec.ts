// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, freshEmail, getActiveBandId, login, signUp } from './fixtures';

test('a non-member never sees a band doc\'s content, even navigating straight to its URL', async ({ page }) => {
  await login(page, DEMO_OWNER_EMAIL);
  const bandId = await getActiveBandId(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login$/);

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
  await expect(page.getByText('Amazing Grace')).not.toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByText('Amazing Grace')).not.toBeVisible();
});
