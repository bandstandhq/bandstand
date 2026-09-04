// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: the menu's Navigation section vanished entirely on
// a band-independent page (Account Settings had no :bandId route param, so
// AppHeader's old navLinks() bailed out with `if (!currentBandId) return
// null`) — every signed-in page must show the exact same set of entries.
//
// "Account settings" itself moved out of the "Band sections" nav landmark
// into its own "Account" section (alongside sign-out) in a later pass —
// see AppHeader.tsx's Sheet JSX — so it's asserted separately below rather
// than as part of BAND_NAV_ENTRIES; the original regression this guards
// against (an entry silently disappearing on some page) still applies to
// both checks.
import { expect, test } from '@playwright/test';
import { login, DEMO_OWNER_EMAIL } from './fixtures';

const BAND_NAV_ENTRIES = ['Repertoire', 'Setlists', 'Calendar', 'Band settings'];

async function openMenuEntries(page: import('@playwright/test').Page): Promise<{
  bandNav: string[];
  hasAccountSettings: boolean;
}> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Band sections' });
  const bandNav = await nav.getByRole('link').allTextContents();
  const hasAccountSettings = await page.getByRole('link', { name: 'Account settings' }).isVisible();
  await page.keyboard.press('Escape');
  return { bandNav, hasAccountSettings };
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
    const { bandNav, hasAccountSettings } = await openMenuEntries(page);
    expect(bandNav, `band nav entries on ${path}`).toEqual(BAND_NAV_ENTRIES);
    expect(hasAccountSettings, `Account settings link on ${path}`).toBe(true);
  }
});

// The desktop (≥640px) sidebar variant — same nav entries as the mobile
// drawer above, reached without opening anything (it's always visible),
// plus its own collapse behavior (button and Cmd/Ctrl+B).
test('the sidebar shows the same navigation entries as the mobile menu, and collapses', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, DEMO_OWNER_EMAIL);
  await page.waitForURL(/\/bands\/.+\/dashboard/);

  const nav = page.getByRole('navigation', { name: 'Band sections' });
  const bandNav = await nav.getByRole('link').allTextContents();
  expect(bandNav).toEqual(BAND_NAV_ENTRIES);
  await expect(page.getByRole('link', { name: 'Account settings' })).toBeVisible();

  const sidebar = page.locator('aside');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');

  await page.keyboard.press('ControlOrMeta+b');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
});
