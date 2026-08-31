// SPDX-License-Identifier: Apache-2.0
//
// The recurring-event dropdown used to offer weekly/biweekly/monthly, where
// "monthly" silently drifted off its start weekday month to month. It now
// offers weekly/biweekly/every-4-weeks/monthly-by-weekday instead (see
// docs/adr/0011-calendar-events.md and eventSeries.ts) — this proves the
// create form actually wires up the new options end to end: picking
// "every 4 weeks" or "monthly (same weekday)" creates a series whose month
// view keeps landing on the same weekday, and the create form shows a
// live hint naming which weekday/ordinal a monthly-by-weekday series will
// actually repeat on.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('picking "monthly (same weekday)" shows a live hint and creates a series that lands on that weekday every month', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'calendar-recurrence-options');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar`);
    await page.getByRole('button', { name: 'New event' }).click();

    // The first Monday, two months from now — computed rather than
    // hardcoded, so this test stays valid regardless of which real month
    // it happens to run in.
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() + 2, 1);
    while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
    const startsAtLocal = `${start.toISOString().slice(0, 10)}T18:00`;

    await page.getByPlaceholder('Event title').fill('Monthly Board Meeting');
    await page.getByLabel('Starts').fill(startsAtLocal);
    await page.getByLabel('Repeats').selectOption('monthlyByWeekday');
    await expect(page.getByText('Repeats on the first Monday of every month.')).toBeVisible();

    await page.getByRole('button', { name: 'Create event' }).click();
    // The 180-day default list view can easily span more than one monthly
    // occurrence — that's the feature working, not ambiguity to resolve.
    await expect(page.getByText('Monthly Board Meeting').first()).toBeVisible();

    // Switch to month view (opens on the current month) and step forward
    // to one month *past* the series' own first occurrence (which starts
    // two months from now) — proving the series actually continues,
    // rather than just showing its own start date.
    await page.getByRole('button', { name: 'Month view' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByText('Monthly Board Meeting').first()).toBeVisible();
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('"every 4 weeks" is offered as its own option, distinct from monthly-by-weekday', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'calendar-recurrence-options-4w');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar`);
    await page.getByRole('button', { name: 'New event' }).click();

    const repeatSelect = page.getByLabel('Repeats');
    await expect(repeatSelect.locator('option', { hasText: 'Every 4 weeks' })).toHaveCount(1);
    await expect(repeatSelect.locator('option', { hasText: 'Monthly' })).toHaveCount(1); // only the "(same weekday)" one
    await repeatSelect.selectOption('every4weeks');
    // No monthly-by-weekday hint for a plain interval-based repeat.
    await expect(page.getByText(/Repeats on the .* of every month\./)).toHaveCount(0);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
