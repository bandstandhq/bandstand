// SPDX-License-Identifier: Apache-2.0
//
// Deleting a band used to be a single window.confirm() click — it's now a
// real dialog gated on typing the band's exact name (see
// docs/adr/0005-permissions.md and BandSettings.tsx's DeleteBandDialog).
// This throwaway band's "test-" slug means the delete happens immediately
// rather than archiving (see the ADR) — the archive/restore path itself is
// covered by apps/server/src/routes/bands.integration.test.ts, which can
// control NODE_ENV directly; this test is about the dialog's own gating.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';

test('deleting a band requires typing its exact name first', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId, name } = await createThrowawayBand(ownerToken, 'band-deletion-dialog');

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto(`/bands/${bandId}/settings`);

    await page.getByRole('button', { name: 'Delete this band' }).click();
    const confirmButton = page.getByRole('button', { name: 'Delete this band' }).last();
    await expect(confirmButton).toBeDisabled();

    const nameInput = page.getByPlaceholder('Band name');
    await nameInput.fill('the wrong name');
    await expect(confirmButton).toBeDisabled();

    await nameInput.fill(name);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await page.waitForURL(/\/dashboard/);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
