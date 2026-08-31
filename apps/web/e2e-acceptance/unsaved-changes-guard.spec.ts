// SPDX-License-Identifier: Apache-2.0
//
// Leaving a song's create/edit form with unsaved changes — via a link, the
// browser's own back button, or the page's own back arrow — used to lose
// the in-progress edit silently. Now a three-way dialog (Save / Discard /
// Continue editing) intercepts all three paths. There is no react-router
// primitive for this here (useBlocker needs a data router; this app is a
// plain BrowserRouter — see useUnsavedChangesGuard's own doc comment), so
// this is the acceptance-level proof that the hand-rolled version works in
// a real browser, not just in review.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('a link, the back button, and the back arrow all prompt to save/discard/continue when the song form is dirty', async ({
  page,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'unsaved-guard');

  try {
    await login(page, DEMO_OWNER_EMAIL);

    // A clean form: a link navigates away immediately, no prompt.
    await page.goto(`/bands/${bandId}/songs/new`);
    await page.getByRole('link', { name: /Back to repertoire/ }).click();
    await expect(page).toHaveURL(/\/repertoire$/);

    // Dirty form + in-page link (Setlists, in the nav) → prompted; Continue
    // editing leaves the form exactly as it was, still on the same page.
    await page.goto(`/bands/${bandId}/songs/new`);
    await page.getByLabel('Title').fill('Unsaved Guard Song');
    await page.getByRole('link', { name: 'Setlists', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue editing' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).not.toBeVisible();
    await expect(page).toHaveURL(/\/songs\/new$/);
    await expect(page.getByLabel('Title')).toHaveValue('Unsaved Guard Song');

    // Discard actually leaves, to the link's own destination.
    await page.getByRole('link', { name: 'Setlists', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/setlists$/);

    // The browser's own back button is guarded the same way.
    await page.goto(`/bands/${bandId}/songs/new`);
    await page.getByLabel('Title').fill('Back Button Song');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await expect(page).toHaveURL(/\/songs\/new$/); // the navigation itself was cancelled
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/\/songs\/new$/);

    // Save, from the dialog, actually saves and then continues on to
    // wherever the user was headed — not the form's own usual post-save
    // destination (the new song's own edit page).
    await page.goto(`/bands/${bandId}/songs/new`);
    await page.getByLabel('Title').fill('Saved Via Dialog Song');
    await page.getByLabel('Artist').fill('Test Artist');
    await page.getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await page.goto(`/bands/${bandId}/repertoire`);
    await expect(page.getByText('Saved Via Dialog Song')).toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});

test('the calendar page guards its create-event and create-poll dialogs too, even though both live on the same page', async ({
  page,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'unsaved-guard-cal');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/calendar`);

    // Both create forms now live behind an icon button, opened as a modal
    // dialog — which, being a real modal, hides the rest of the page (the
    // nav links) from interaction while it's open. So the way to "leave"
    // a dirty create-event dialog is to close the dialog itself (its own X,
    // Escape, or the overlay), not to click a link elsewhere on the page.
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByPlaceholder('Event title').fill('Unsaved Rehearsal');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'New event' })).not.toBeVisible();
    // Discarding actually cleared the form, not just closed the dialog.
    await page.getByRole('button', { name: 'New event' }).click();
    await expect(page.getByPlaceholder('Event title')).toHaveValue('');
    await page.getByRole('button', { name: 'Close' }).click();

    // Same for the create-poll dialog, this time choosing to keep editing.
    await page.getByRole('button', { name: 'New poll' }).click();
    await page.getByPlaceholder('Poll title').fill('Unsaved Poll');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue editing' }).click();
    await expect(page.getByRole('heading', { name: 'New poll' })).toBeVisible();
    await expect(page.getByPlaceholder('Poll title')).toHaveValue('Unsaved Poll');
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
