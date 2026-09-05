// SPDX-License-Identifier: Apache-2.0
//
// CreateBandForm.tsx (used for a brand-new account's very first band, via
// DashboardRedirect, and inside the band switcher's own dialog everywhere
// else — see BandSwitcher.tsx) used to render a failed request's raw
// exception message directly — whatever the fetch/network layer happened
// to throw, in English, never translated. It now shows a generic,
// translated fallback instead.
import { expect, test } from '@playwright/test';
import { deleteTestAccount, freshEmail } from './fixtures';

test('a failed "create band" request shows a translated error, not a raw exception message', async ({ page }) => {
  const email = freshEmail('create-band-error');
  const password = 'bandstand-demo';

  try {
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Create Band Error Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign up' }).click();

    // Lands on the brand-new, zero-bands /dashboard — DashboardRedirect's
    // own "create your first band" form.
    await expect(page.getByRole('heading', { name: 'Welcome to Bandstand' })).toBeVisible();

    await page.route('**/bands', (route) =>
      route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue(),
    );

    await page.getByPlaceholder('Band name').fill('Doomed Band');
    await page.getByRole('button', { name: 'Create band' }).click();

    await expect(page.getByText("Couldn't create the band. Please try again.")).toBeVisible();
    await expect(page.getByText(/failed to fetch/i)).not.toBeVisible();
  } finally {
    await deleteTestAccount(email);
  }
});
