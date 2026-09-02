// SPDX-License-Identifier: Apache-2.0
//
// Editing an existing series' own recurrence rule (frequency/until) was
// deliberately out of scope for EditEventForm (see its own doc comment) —
// there was no way to change how often a recurring event repeats once
// created at all (issue #177). "Change recurrence…" is a dedicated action,
// reachable from any occurrence of a series, that splits the series into
// two templates at that date rather than mutating the rule in place — see
// changeSeriesRecurrence's own doc comment for why: any existing
// exception/cancellation before the split date must keep resolving exactly
// as it did before.
import { createRecurringEvent, createSeriesException, resolveEventOccurrences } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

const DAY_MS = 24 * 60 * 60 * 1000;

test('changing a series\' recurrence from a later occurrence preserves earlier dates and their exceptions', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'change-recurrence');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  // Weekly, starting tomorrow: occurrence #1 (a week out) gets its own
  // exception; occurrence #4 (four weeks out) is where the rule changes.
  const start = Date.now() + DAY_MS;
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Weekly Rehearsal', startsAt: start, allDay: false, status: 'confirmed' },
    { freq: 'weekly' },
  );
  const occurrence1Date = new Date(start + 7 * DAY_MS).toISOString().slice(0, 10);
  const occurrence4Date = new Date(start + 28 * DAY_MS).toISOString().slice(0, 10);
  const occurrence5Date = new Date(start + 35 * DAY_MS).toISOString().slice(0, 10);
  createSeriesException(setup.doc, seriesId, occurrence1Date, { notes: 'Extra long rehearsal' });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);

    await page.goto(`/bands/${bandId}/calendar/${seriesId}@${occurrence4Date}`);
    await page.getByRole('button', { name: 'Change recurrence…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Change recurrence pattern')).toBeVisible();
    await expect(dialog.getByText(occurrence4Date, { exact: false })).toBeVisible();
    await dialog.getByLabel('Repeats').selectOption('every4weeks');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    // Landed on the new template's own page — never the old synthetic id,
    // which no longer resolves to anything once the old template is capped.
    await expect(page).not.toHaveURL(`/bands/${bandId}/calendar/${seriesId}@${occurrence4Date}`);
    await expect(page.getByRole('heading', { name: 'Weekly Rehearsal' })).toBeVisible();
    await flush();

    // The existing exception on occurrence #1 (well before the split) still
    // resolves exactly as it did before — untouched by the rule change.
    const events = setup.doc.getMap('events').toJSON();
    const resolved = resolveEventOccurrences(events, start - DAY_MS, start + 40 * DAY_MS);
    expect(resolved.find((o) => o.date === occurrence1Date)?.event.notes).toBe('Extra long rehearsal');
    // Occurrence #4 itself now exists (under the new template).
    expect(resolved.some((o) => o.date === occurrence4Date)).toBe(true);
    // Occurrence #5 would exist under the old weekly rule, but the new
    // every-4-weeks rule (starting at #4) never lands on it.
    expect(resolved.some((o) => o.date === occurrence5Date)).toBe(false);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
    setup.provider.destroy();
  }
});
