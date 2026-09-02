// SPDX-License-Identifier: Apache-2.0
//
// Editing a recurring event's own template occurrence used to silently
// patch the template record directly — every field, including notes —
// cascading onto every future occurrence that didn't already have its own
// exception, with no way to say "just this date." Same class of bug as the
// cancel button's own (see event-trash-button.spec.ts's template-occurrence
// test), fixed here by asking which scope to apply the edit to instead of
// always picking one silently.
import { createRecurringEvent, createSeriesException, listEvents, resolveEventOccurrences } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

async function editTemplateOccurrence(page: import('@playwright/test').Page, bandId: string, seriesId: string, notes: string) {
  await page.goto(`/bands/${bandId}/calendar/${seriesId}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
  await page.getByPlaceholder('Notes').fill(notes);
  await page.getByRole('button', { name: 'Save changes' }).click();
}

test('editing just the template occurrence\'s notes leaves the template and future dates untouched', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-edit-scope-occurrence');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Weekly Rehearsal', startsAt: now + 24 * 60 * 60 * 1000, allDay: false, status: 'confirmed', notes: 'Original notes' },
    { freq: 'weekly' },
  );
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await editTemplateOccurrence(page, bandId, seriesId, 'Just this date notes');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Apply this change to…')).toBeVisible();
    await dialog.getByRole('button', { name: 'Just this date' }).click();

    await expect(page.getByRole('heading', { name: 'Edit event' })).not.toBeVisible();
    await expect(page.getByText('Just this date notes')).toBeVisible();

    // The template record itself never changed.
    expect(listEvents(setup.doc)[seriesId]?.notes).toBe('Original notes');

    // A later occurrence still has the original notes — the edit didn't cascade.
    const laterStart = now + 20 * 24 * 60 * 60 * 1000;
    const laterEnd = now + 24 * 24 * 60 * 60 * 1000;
    const later = resolveEventOccurrences(listEvents(setup.doc), laterStart, laterEnd);
    expect(later).toHaveLength(1);
    expect(later[0]?.event.notes).toBe('Original notes');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('editing "this and all following" updates the template and future dates, but not an existing exception', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-edit-scope-series');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Weekly Rehearsal', startsAt: now + 24 * 60 * 60 * 1000, allDay: false, status: 'confirmed', notes: 'Original notes' },
    { freq: 'weekly' },
  );
  // A future date, three weeks out, already has its own individual override
  // — this is the case the user specifically confirmed should survive a
  // "this and all following" edit made from the template.
  const exceptionDate = new Date(now + 22 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  createSeriesException(setup.doc, seriesId, exceptionDate, { notes: 'Individually customized notes' });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await editTemplateOccurrence(page, bandId, seriesId, 'New notes for the whole series');

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'This and all following' }).click();

    await expect(page.getByRole('heading', { name: 'Edit event' })).not.toBeVisible();
    await expect(page.getByText('New notes for the whole series')).toBeVisible();

    // The template itself now carries the new notes.
    expect(listEvents(setup.doc)[seriesId]?.notes).toBe('New notes for the whole series');

    // A later date with no exception of its own picked up the change...
    const plainLaterStart = now + 27 * 24 * 60 * 60 * 1000;
    const plainLaterEnd = now + 31 * 24 * 60 * 60 * 1000;
    const plainLater = resolveEventOccurrences(listEvents(setup.doc), plainLaterStart, plainLaterEnd);
    expect(plainLater).toHaveLength(1);
    expect(plainLater[0]?.event.notes).toBe('New notes for the whole series');

    // ...but the date that already had its own individual override kept it.
    const exceptionStart = Date.parse(`${exceptionDate}T00:00:00.000Z`);
    const exceptionEnd = Date.parse(`${exceptionDate}T23:59:59.999Z`);
    const exceptionOccurrence = resolveEventOccurrences(listEvents(setup.doc), exceptionStart, exceptionEnd);
    expect(exceptionOccurrence).toHaveLength(1);
    expect(exceptionOccurrence[0]?.event.notes).toBe('Individually customized notes');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
