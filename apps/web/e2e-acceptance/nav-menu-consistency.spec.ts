// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: the menu's Navigation section vanished entirely on
// a band-independent page (Account Settings had no :bandId route param, so
// AppHeader's old navLinks() bailed out with `if (!currentBandId) return
// null`) — every signed-in page must show the exact same set of entries.
import { expect, test } from '@playwright/test';
import { login, DEMO_OWNER_EMAIL } from './fixtures';

const EXPECTED_NAV_ENTRIES = ['Repertoire', 'Setlists', 'Calendar', 'Band settings', 'Account settings'];

async function navEntries(page: import('@playwright/test').Page): Promise<string[]> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Band sections' });
  const texts = await nav.getByRole('link').allTextContents();
  await page.keyboard.press('Escape');
  return texts;
}

test('the menu shows the same navigation entries on every signed-in page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_OWNER_EMAIL);
  // login() itself only waits for either the bare /dashboard or a real
  // /bands/:bandId/dashboard — DashboardRedirect's own client-side
  // <Navigate> to the latter can still be in flight at that point, so wait
  // for it explicitly rather than reading the URL immediately.
  await page.waitForURL(/\/bands\/.+\/dashboard/);
  const bandId = page.url().match(/\/bands\/([^/]+)\/dashboard/)?.[1];
  if (!bandId) throw new Error(`Could not read active band id from URL: ${page.url()}`);

  const pages = [
    `/bands/${bandId}/dashboard`,
    `/bands/${bandId}/repertoire`,
    `/bands/${bandId}/setlists`,
    `/bands/${bandId}/calendar`,
    `/bands/${bandId}/settings`,
    // The whole point: this page has no :bandId in its own URL at all.
    '/settings',
  ];

  for (const path of pages) {
    await page.goto(path);
    const entries = await navEntries(page);
    expect(entries, `menu entries on ${path}`).toEqual(EXPECTED_NAV_ENTRIES);
  }
});
