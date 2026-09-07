// SPDX-License-Identifier: Apache-2.0
//
// Regression test for: navigating to a different page kept whatever scroll
// position the page navigated away from had, instead of starting at the
// top — react-router doesn't do this on its own (see ScrollToTop.tsx). A
// short viewport guarantees real pages overflow it regardless of how much
// content a given page happens to have right now.
import { expect, test } from '@playwright/test';
import { login, DEMO_OWNER_EMAIL } from './fixtures';

test('navigating to a different page always starts scrolled to the top', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await login(page, DEMO_OWNER_EMAIL);
  await page.waitForURL(/\/bands\/.+\/dashboard/);
  const bandId = page.url().match(/\/bands\/([^/]+)\/dashboard/)?.[1];
  if (!bandId) throw new Error(`Could not read active band id from URL: ${page.url()}`);

  await page.goto(`/bands/${bandId}/settings`);
  // The page's own content (members, invites, ...) still loads
  // asynchronously right after navigation — scrolling before it's tall
  // enough to overflow the viewport would just clamp back to 0, so retry
  // the scroll itself (not just the read) until it takes.
  await expect
    .poll(() => page.evaluate(() => (window.scrollTo(0, 300), window.scrollY)))
    .toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Repertoire', exact: true }).click();
  await page.waitForURL(/\/repertoire$/);
  // ScrollToTop.tsx resets scroll from a useEffect, which commits a moment
  // after the URL itself changes — reading scrollY synchronously right
  // after waitForURL can win that race and see the old, pre-navigation
  // value, so poll instead of asserting once.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
