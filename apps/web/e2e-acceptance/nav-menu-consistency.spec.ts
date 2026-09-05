// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: the menu's Navigation section vanished entirely on
// a band-independent page (Account Settings had no :bandId route param, so
// AppHeader's old navLinks() bailed out with `if (!currentBandId) return
// null`) — every signed-in page must show the exact same set of entries
// *within* each layout.
//
// The two layouts deliberately no longer show the same tab set (issue
// #244): the bottom nav leads with a Dashboard tab (useful one-handed, on
// mobile) and tucks Band settings into "More" to make room for it, while
// the sidebar has no Dashboard entry (the header logo already covers that
// on wide screens) and keeps Band settings as a direct link — so this file
// asserts each layout's own entries separately instead of one shared array.
//
// "Account settings" itself lives outside the "Band sections" nav landmark
// (alongside sign-out) in both layouts here — the sidebar's footer shows it
// directly, the bottom nav's "More" tab surfaces it via a sheet — so it's
// asserted separately below rather than as part of either entries array;
// the original regression this guards against (an entry silently
// disappearing on some page) still applies to both checks.
import { expect, test } from '@playwright/test';
import { login, DEMO_OWNER_EMAIL } from './fixtures';

const MOBILE_NAV_ENTRIES = ['Dashboard', 'Repertoire', 'Setlists', 'Calendar'];
const DESKTOP_NAV_ENTRIES = ['Repertoire', 'Setlists', 'Calendar', 'Band settings'];

async function bottomNavEntries(page: import('@playwright/test').Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Band sections' });
  // allTextContents() reads the DOM once, with no auto-waiting — fine right
  // after login (already settled), but each page.goto() below is a full
  // reload that needs a moment to bootstrap and mount this nav, so wait for
  // the first entry before reading the rest, or an early iteration races
  // the page load and reads an empty list.
  await nav.getByRole('link').first().waitFor();
  return nav.getByRole('link').allTextContents();
}

test('the bottom nav shows the same navigation entries on every signed-in page, and "More" reveals Band settings and Account settings', async ({
  page,
}) => {
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
    // These tabs are always visible — nothing to open first.
    expect(await bottomNavEntries(page), `bottom nav entries on ${path}`).toEqual(MOBILE_NAV_ENTRIES);

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('link', { name: 'Band settings' }), `Band settings link on ${path}`).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account settings' }), `Account settings link on ${path}`).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

// The wide-screen (≥640px) sidebar — its own nav entries (deliberately not
// the same set as the mobile bottom nav above — see the file comment),
// reached without opening anything (it's always visible), plus its own
// collapse behavior (button and Cmd/Ctrl+B).
test('the sidebar shows its own navigation entries, and collapses', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, DEMO_OWNER_EMAIL);
  await page.waitForURL(/\/bands\/.+\/dashboard/);

  const nav = page.getByRole('navigation', { name: 'Band sections' });
  const bandNav = await nav.getByRole('link').allTextContents();
  expect(bandNav).toEqual(DESKTOP_NAV_ENTRIES);
  await expect(page.getByRole('link', { name: 'Account settings' })).toBeVisible();

  const sidebar = page.locator('aside');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');

  await page.keyboard.press('ControlOrMeta+b');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
});
