// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_PASSWORD } from './fixtures';

test('unauthenticated /dashboard redirects to /login, and logging in lands back on /dashboard', async ({ page }) => {
  // Visiting a protected route while anonymous is what previously left the
  // session store settled at "confirmed anonymous" for the rest of this
  // tab — logging in right after that, from /login, is exactly the
  // sequence that used to bounce straight back to /login instead of
  // landing on /dashboard (see Login.tsx's refetch() fix).
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);

  await page.getByLabel('Email').fill(DEMO_OWNER_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  // Confirms it's a real, settled landing — not a moment mid-bounce.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/dashboard$/);
});
