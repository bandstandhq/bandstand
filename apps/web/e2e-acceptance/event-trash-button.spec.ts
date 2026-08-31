// SPDX-License-Identifier: Apache-2.0
//
// The trash button on an event's detail page used to be two separate
// affordances: a "Cancel this date" text link (series occurrences only) and
// a permanent-delete icon. They're now one button whose behavior depends on
// how long ago the event was actually created (never touched by a later
// edit) — within five minutes it deletes for good, same as undoing a fresh
// mistake; after that, or for a virtual (never-materialized) series
// occurrence that has nothing real to delete yet, it cancels instead.
import { createEvent, createRecurringEvent, listEvents, type CalendarEvent } from '@bandstand/core';
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
    // window.confirm is auto-dismissed by Playwright unless handled — both
    // Delete and Cancel here go through a plain confirm(), not the app's
    // real Dialog component.
    page.on('dialog', (dialog) => dialog.accept());

    // A plain event, seconds old — deletes for good.
    await page.goto(`/bands/${bandId}/calendar/${eventId}`);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForURL(/\/calendar$/);
    expect(listEvents(setup.doc)[eventId]).toBeUndefined();

    // A virtual occurrence of the series — the series itself is seconds
    // old too, but this particular occurrence was never materialized, so
    // there's nothing real to delete.
    const virtualOccurrenceId = `${seriesId}@${new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`;
    await page.goto(`/bands/${bandId}/calendar/${virtualOccurrenceId}`);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
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
    // window.confirm is auto-dismissed by Playwright unless handled — both
    // Delete and Cancel here go through a plain confirm(), not the app's
    // real Dialog component.
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`/bands/${bandId}/calendar/${eventId}`);

    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Cancelled, not deleted — the event still exists, just marked so.
    await expect(page.getByText('(cancelled)')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/calendar/${eventId}$`));
    expect(listEvents(setup.doc)[eventId]?.status).toBe('cancelled');
  } finally {
    setup.provider.destroy();
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
