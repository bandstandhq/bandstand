// SPDX-License-Identifier: Apache-2.0
//
// An archived band (see docs/adr/0005-permissions.md) disappears from the
// normal band list/switcher but stays visible to its owner in Account
// Settings' "recently deleted" section until it's restored or the 30-day
// grace period elapses. Marks the band archived directly via testDb.ts
// rather than the real DELETE route, since that route only archives (as
// opposed to deleting immediately) under NODE_ENV=production, which the
// acceptance webServer doesn't run under — see band-deletion-dialog.spec.ts
// and bands.integration.test.ts for the parts of this feature that do
// exercise the real route.
import { expect, test } from '@playwright/test';
import { createThrowawayBand, DEMO_OWNER_EMAIL, DEMO_PASSWORD, deleteThrowawayBand, login } from './fixtures';
import { signInForToken } from './hocuspocusTestClient';
import { archiveBand, withDb } from './testDb';

test('an archived band is hidden from the switcher but restorable from Account Settings', async ({ page }) => {
  const ownerToken = await signInForToken(DEMO_OWNER_EMAIL, DEMO_PASSWORD);
  const { bandId, name } = await createThrowawayBand(ownerToken, 'archived-restore');
  await withDb((client) => archiveBand(client, bandId, new Date()));

  try {
    await login(page, DEMO_OWNER_EMAIL);
    await page.goto('/dashboard');
    await expect(page.getByLabel('Active band').locator('option', { hasText: name })).toHaveCount(0);

    await page.goto('/settings');
    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Permanently deleted on/)).toBeVisible();

    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row).toHaveCount(0);

    await page.goto('/dashboard');
    await expect(page.getByLabel('Active band').locator('option', { hasText: name })).toHaveCount(1);
  } finally {
    await deleteThrowawayBand(ownerToken, bandId);
  }
});
