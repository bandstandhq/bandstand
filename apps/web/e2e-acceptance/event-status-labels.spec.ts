// SPDX-License-Identifier: Apache-2.0
//
// The "cancelled"/"tentative" suffix used to be inconsistent: an inline
// label in the calendar list, a separate badge on the detail page, and not
// shown at all in the month grid or on the dashboard. Now every place that
// renders an event title renders the same greyed-out suffix right after it
// (EventStatusSuffix). This only re-proves the list view and the detail
// page — those two already had *some* status rendering before, so they're
// the two most likely to have silently regressed; the month grid and
// dashboard are new coverage but exercise the exact same component.
import { createEvent } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

test('a cancelled and a tentative event both show a greyed-out status suffix after their title, in the list and on the detail page', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-status-labels');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  try {
    const now = Date.now();
    const cancelledId = createEvent(setup.doc, {
      type: 'rehearsal',
      title: 'Cancelled Rehearsal',
      startsAt: now + 24 * 60 * 60 * 1000,
      allDay: false,
      status: 'cancelled',
    });
    const tentativeId = createEvent(setup.doc, {
      type: 'gig',
      title: 'Tentative Gig',
      startsAt: now + 2 * 24 * 60 * 60 * 1000,
      allDay: false,
      status: 'tentative',
    });
    await setup.waitForSynced();

    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar`);

    // The link that makes the row clickable is an absolutely-positioned
    // overlay with only an aria-label, no visible text of its own — the
    // title + status suffix live in a sibling element, so the row's <li>
    // (not the link) is what actually contains both.
    const cancelledRow = page.locator('li').filter({ hasText: 'Cancelled Rehearsal' });
    await expect(cancelledRow).toContainText('(cancelled)');
    const tentativeRow = page.locator('li').filter({ hasText: 'Tentative Gig' });
    await expect(tentativeRow).toContainText('(tentative)');

    await page.goto(`/bands/${bandId}/calendar/${cancelledId}`);
    await expect(page.getByRole('heading', { name: /Cancelled Rehearsal/ })).toContainText('(cancelled)');

    await page.goto(`/bands/${bandId}/calendar/${tentativeId}`);
    await expect(page.getByRole('heading', { name: /Tentative Gig/ })).toContainText('(tentative)');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
