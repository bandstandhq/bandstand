// SPDX-License-Identifier: Apache-2.0
//
// Regression test for issue: creating a song failed with a single generic
// "check the fields above" message that never said which field, even when
// every field looked filled in — see docs/adr's drag-drop ADR sibling notes
// for the same "never collapse distinct failures into one message" theme
// applied here to song creation.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('creating a song names the specific missing field instead of a generic message, and only requires title + artist', async ({
  page,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'song-validation');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/new`);

    // Required fields are marked before any failed attempt, not only after
    // one — two marks, for Title and Artist, nothing else.
    await expect(page.locator('[aria-label="required"]')).toHaveCount(2);

    // Nothing filled in at all: the topmost missing field (Title) is named.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Title is required.')).toBeVisible();
    await expect(page.getByText('Artist is required.')).not.toBeVisible();
    await expect(page).toHaveURL(/\/songs\/new$/);

    // Title filled, Artist still empty: the next-topmost missing field.
    await page.getByLabel('Title').fill('Test Song');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Artist is required.')).toBeVisible();
    await expect(page).toHaveURL(/\/songs\/new$/);

    // Title + Artist filled, everything else left at its default (BPM,
    // duration, key, status) — this alone must be enough to save. Saving a
    // new song lands on its own edit page (not back on the list) — see
    // SongEditor's own comment on why.
    await page.getByLabel('Artist').fill('Test Artist');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('Title')).toHaveValue('Test Song');
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
