// SPDX-License-Identifier: Apache-2.0
//
// The trash button on an event's detail page went through two rounds of
// consolidation. First (#159): a "Cancel this date" text link (series
// occurrences only) and a permanent-delete icon became one button, whose
// behavior depends on how long ago the event was actually created (never
// touched by a later edit) — within five minutes it deletes for good, same
// as undoing a fresh mistake; after that, or for a virtual (never-
// materialized) series occurrence that has nothing real to delete yet, it
// cancels instead. Second (this file, now): that button used to sit next to
// a second, identically-styled trash icon for "delete the whole series" —
// indistinguishable at a glance. Now there is exactly one trash icon; for a
// plain event it opens a real (not window.confirm) yes/no dialog, and for
// an occurrence of a recurring series it opens a choice between acting on
// just this date or the entire series.
import { createEvent, createRecurringEvent, listEvents, resolveEventOccurrences, type CalendarEvent } from '@bandstand/core';
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { connectTestBandDoc, signInForToken } from './hocuspocusTestClient';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

test('a freshly created event can be deleted outright, but a virtual occurrence of a brand-new series can only be cancelled', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-trash-fresh');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const eventId = createEvent(setup.doc, {
    type: 'rehearsal',
    title: 'Brand New Rehearsal',
    startsAt: now + 24 * 60 * 60 * 1000,
    allDay: false,
    status: 'confirmed',
  });
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Brand New Series', startsAt: now + 2 * 24 * 60 * 60 * 1000, allDay: false, status: 'confirmed' },
    { freq: 'weekly' },
  );
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);

    // A plain event, seconds old — deletes for good via the app's own
    // styled confirm dialog, not a native window.confirm.
    await page.goto(`/bands/${bandId}/calendar/${eventId}`);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog.getByText('Brand New Rehearsal')).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForURL(/\/calendar$/);
    expect(listEvents(setup.doc)[eventId]).toBeUndefined();

    // A virtual occurrence of the series — the series itself is seconds
    // old too, but this particular occurrence was never materialized, so
    // there's nothing real to delete. Belonging to a series, the trash
    // button opens a choice between this date and the whole series.
    const virtualOccurrenceId = `${seriesId}@${new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`;
    await page.goto(`/bands/${bandId}/calendar/${virtualOccurrenceId}`);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const choiceDialog = page.getByRole('dialog');
    await expect(choiceDialog.getByText('Brand New Series')).toBeVisible();
    await expect(choiceDialog.getByRole('button', { name: 'Delete entire series' })).toBeVisible();
    await choiceDialog.getByRole('button', { name: 'Cancel event' }).click();
    await expect(page.getByText('(cancelled)')).toBeVisible();
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('past the grace period, the same trash button cancels an event instead of deleting it', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-trash-old');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const eventId = createEvent(setup.doc, {
    type: 'gig',
    title: 'Old Enough Gig',
    startsAt: now + 24 * 60 * 60 * 1000,
    allDay: false,
    status: 'confirmed',
  });
  // Backdate createdAt past the five-minute grace window — simulates an
  // event that's been sitting around for a while, without waiting for real
  // time to pass.
  const events = setup.doc.getMap('events');
  const original = events.get(eventId) as CalendarEvent;
  events.set(eventId, { ...original, createdAt: now - 10 * 60 * 1000 });
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar/${eventId}`);

    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Old Enough Gig')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel event' }).click();

    // Cancelled, not deleted — the event still exists, just marked so.
    await expect(page.getByText('(cancelled)')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/calendar/${eventId}$`));
    expect(listEvents(setup.doc)[eventId]?.status).toBe('cancelled');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('choosing "delete entire series" from the trash button removes every occurrence', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-trash-series');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Weekly Rehearsal To Delete', startsAt: now + 24 * 60 * 60 * 1000, allDay: false, status: 'confirmed' },
    { freq: 'weekly' },
  );
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar/${seriesId}`);

    // The series template's own occurrence is never eligible for a
    // same-occurrence permanent delete, regardless of age (see
    // isSeriesTemplateOccurrence) — its "just this date" action is always
    // "Cancel event", but that's not the action under test here.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete entire series' }).click();

    await page.waitForURL(/\/calendar$/);
    expect(listEvents(setup.doc)[seriesId]).toBeUndefined();
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});

test('cancelling just the series template\'s own first occurrence leaves the rest of the series untouched', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'event-trash-template-occurrence');
  const setup = connectTestBandDoc(bandId, ownerToken);
  await setup.waitForSynced();

  const now = Date.now();
  // The template's own occurrence (opened at /calendar/:seriesId, same as
  // clicking the first entry of a weekly series in the calendar list) is a
  // real `events` entry, not a virtual one — cancelling it used to patch
  // the template record's own `status` in place, which every later virtual
  // occurrence then inherited by spreading the (now cancelled) template,
  // making the entire series vanish instead of just this one date.
  const seriesId = createRecurringEvent(
    setup.doc,
    { type: 'rehearsal', title: 'Weekly Rehearsal Not To Vanish', startsAt: now + 24 * 60 * 60 * 1000, allDay: false, status: 'confirmed' },
    { freq: 'weekly' },
  );
  await flush();

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar/${seriesId}`);

    // canPermanentlyDelete is false for the template's own occurrence (see
    // EventDetail.tsx), so this is "Cancel", not "Delete".
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel event' }).click();

    await expect(page.getByText('(cancelled)')).toBeVisible();

    // The template record itself is untouched — only a fresh exception for
    // that one date carries the cancellation.
    expect(listEvents(setup.doc)[seriesId]?.status).not.toBe('cancelled');

    // A later occurrence, three weeks out, is still a normal, active one —
    // the whole series didn't vanish along with the first date.
    const laterWindowStart = now + 20 * 24 * 60 * 60 * 1000;
    const laterWindowEnd = now + 24 * 24 * 60 * 60 * 1000;
    const laterOccurrences = resolveEventOccurrences(listEvents(setup.doc), laterWindowStart, laterWindowEnd);
    expect(laterOccurrences).toHaveLength(1);
    expect(laterOccurrences[0]?.event.status).toBe('confirmed');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
