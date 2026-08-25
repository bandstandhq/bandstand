// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { DEMO_OWNER_EMAIL, freshEmail, getActiveBandId, login, signUp } from './fixtures';

const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

test('an invite code redeems exactly once', async ({ page }) => {
  await login(page, DEMO_OWNER_EMAIL);
  const bandId = await getActiveBandId(page);
  await page.goto(`/bands/${bandId}/settings`);

  const label = `Acceptance test ${Date.now()}`;
  await page.getByLabel('Note').fill(label);
  await page.getByRole('button', { name: 'Create invite' }).click();
  const code = await page.getByText(INVITE_CODE_PATTERN).first().innerText();
  expect(code).toMatch(INVITE_CODE_PATTERN);

  // BandSettings has no logout control of its own.
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login/);

  // First redemption succeeds and joins the band.
  await page.goto(`/join/${code}`);
  await signUp(page, { name: 'First redeemer', email: freshEmail('first') }, 'Sign up and join');
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Repertoire' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/login/);

  // A second redemption of the same already-used code is refused, and the
  // refusal is surfaced to the user, not just a silent failure.
  await page.goto(`/join/${code}`);
  await signUp(page, { name: 'Second redeemer', email: freshEmail('second') }, 'Sign up and join');
  await expect(page.getByText('That invite code has already been used.')).toBeVisible();
  await expect(page).not.toHaveURL(/\/dashboard$/);
});
