// SPDX-License-Identifier: Apache-2.0
//
// activeBandId used to be plain persisted client state with no concept of
// *whose* session it belonged to — sign out, someone else signs in on the
// same device, and the new session's own Dashboard would try to load
// whatever band the previous person had last viewed, landing on a "you're
// not a member" error despite never having navigated there. Distinct from
// non-member-access.spec.ts, which is about a non-member explicitly
// visiting a band's URL — this is about landing on your *own*, band-less
// /dashboard and seeing no trace of the last person's band at all.
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_PASSWORD, freshEmail, login } from './fixtures';

test("logging in as a different user never shows the previous user's last-viewed band", async ({ page }) => {
  // User A: has real bands, opens one.
  await login(page, DEMO_OWNER_EMAIL);
  await expect(page).toHaveURL(/\/bands\/.+\/dashboard$/);
  await page.getByRole('link', { name: 'Repertoire' }).click();
  await expect(page).toHaveURL(/\/repertoire$/);

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login/);

  // User B: brand new, a member of nothing.
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Session Isolation Tester');
  await page.getByLabel('Email').fill(freshEmail('session-isolation'));
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();

  // Lands on their own bare /dashboard (DashboardRedirect's zero-bands
  // state) — never bounced into A's band, and never shown a membership
  // error for a band B never asked to see.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("You're not a member of this band")).not.toBeVisible();
  await expect(page.getByText('Select or create a band to get started.')).toBeVisible();
});
