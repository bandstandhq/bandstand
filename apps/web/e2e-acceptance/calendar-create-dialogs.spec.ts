// SPDX-License-Identifier: Apache-2.0
//
// The always-visible "New event"/"New poll" forms used to take up most of
// the calendar page permanently. They now sit behind a single "Create" icon
// button, whose dropdown offers "New event"/"New poll", each opening as a
// modal dialog — full height on a phone, a centered card above it
// (packages/ui's shared Dialog already does this; nothing here is
// calendar-specific). This only proves the calendar-specific wiring: the
// menu opens the right dialog, creating something closes it again, and the
// phone layout is actually full height, not just centered-but-small.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

async function openCreateMenuItem(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('menuitem', { name }).click();
}

test('the create menu\'s new-event and new-poll items open a dialog, and creating something closes it', async ({
  page,
}) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(ownerToken, 'calendar-create-dialogs');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar`);

    // Neither dialog is open on page load — no permanent form taking up
    // the page any more.
    await expect(page.getByPlaceholder('Event title')).not.toBeVisible();
    await expect(page.getByPlaceholder('Poll title')).not.toBeVisible();

    await openCreateMenuItem(page, 'New event');
    await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible();
    await page.getByPlaceholder('Event title').fill('Dialog-Created Rehearsal');
    await page.getByLabel('Starts').fill('2027-01-15T18:00');
    await page.getByRole('button', { name: 'Create event' }).click();
    // A successful create closes the dialog on its own.
    await expect(page.getByRole('heading', { name: 'New event' })).not.toBeVisible();
    await expect(page.getByText('Dialog-Created Rehearsal')).toBeVisible();

    await openCreateMenuItem(page, 'New poll');
    await expect(page.getByRole('heading', { name: 'New poll' })).toBeVisible();
    await page.getByPlaceholder('Poll title').fill('Dialog-Created Poll');
    await page.locator('input[type="datetime-local"]').first().fill('2027-01-20T18:00');
    await page.getByRole('button', { name: 'Create poll' }).click();
    await expect(page.getByRole('heading', { name: 'New poll' })).not.toBeVisible();
    await expect(page.getByText('Dialog-Created Poll')).toBeVisible();

    // On a phone-sized viewport, the open dialog covers the full screen —
    // not just a small centered card, per the same rule every dialog in
    // this app already follows (packages/ui's Dialog).
    await page.setViewportSize({ width: 360, height: 800 });
    await openCreateMenuItem(page, 'New event');
    const dialogBox = await page.getByRole('dialog').boundingBox();
    expect(dialogBox?.width).toBeGreaterThan(340);
    expect(dialogBox?.height).toBeGreaterThan(700);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
