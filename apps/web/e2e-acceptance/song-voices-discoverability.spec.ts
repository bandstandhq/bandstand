// SPDX-License-Identifier: Apache-2.0
//
// The Voices section (where you attach a PDF/image "part", including a
// multi-page full score) used to render nothing at all for a brand-new
// song, and creating a song sent you back to the repertoire list instead
// of into the edit page where Voices lives — so a member asking "how do I
// add a full score?" had no visible path to it right after creating a
// song. It's now always present (collapsed by default, on any song), and
// saving a new song lands directly on its own edit page.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('the Voices section is present but collapsed right after creating a song, and expands to reveal Add a part', async ({
  page,
}) => {
  const token = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId } = await createThrowawayBand(token, 'song-voices');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/songs/new`);
    await page.getByLabel('Title').fill('Voices Discoverability Song');
    await page.getByLabel('Artist').fill('Test Artist');
    await page.getByRole('button', { name: 'Save' }).click();

    // Saving a brand-new song lands on its own edit page, not the list.
    await expect(page).toHaveURL(/\/edit$/);

    // The Voices section is visible (a default ChordPro voice always exists)
    // but collapsed — its contents aren't in the accessibility tree yet.
    const voicesSummary = page.getByText(/Voices \(1\)/);
    await expect(voicesSummary).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a part (PDF or image)' })).not.toBeVisible();

    // Expanding it reveals the upload entry point and the multi-page hint.
    await voicesSummary.click();
    await expect(page.getByRole('button', { name: 'Add a part (PDF or image)' })).toBeVisible();
    await expect(page.getByText(/multiple pages/i)).toBeVisible();

    // A fresh load starts collapsed again.
    await page.reload();
    await expect(page.getByText(/Voices \(1\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a part (PDF or image)' })).not.toBeVisible();
  } finally {
    await deleteThrowawayBand(token, bandId);
  }
});
