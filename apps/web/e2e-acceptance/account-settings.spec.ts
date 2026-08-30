// SPDX-License-Identifier: Apache-2.0
//
// The two account-wide settings from user_prefs (GlobalPrefsEffects.tsx,
// AccountSettings.tsx): keeping the screen awake app-wide, and the active
// language, both round-tripping through the server rather than staying
// only local. Owns a throwaway signed-up user rather than demo-owner —
// this test deliberately changes the account's language, which would
// otherwise break every other acceptance test's English-text assertions
// for whoever runs after it (issue #81's "no shared-account mutation"
// rule extends to prefs, not just band content — see password-reset.spec.ts
// for the same reasoning).
import { expect, test } from '@playwright/test';
import { freshEmail, freshName } from './fixtures';

test('the wake-lock and language settings persist across reloads', async ({ page }) => {
  const email = freshEmail('account-settings');
  const name = freshName('Account Settings User');

  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('account-settings-password-1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);

  await page.goto('/settings');

  const wakeLockCheckbox = page.getByRole('checkbox', { name: 'Keep the display on while Bandstand is open' });
  await expect(wakeLockCheckbox).toBeVisible();
  await expect(wakeLockCheckbox).not.toBeChecked(); // off by default
  // Not .check() — the checkbox is controlled by an async PATCH round-trip
  // (see AccountSettings.tsx's onChange), so its own built-in "did the
  // click actually change the state" verification can race that request.
  // A plain click plus a separately-retrying assertion doesn't.
  await wakeLockCheckbox.click();
  await expect(wakeLockCheckbox).toBeChecked();

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Keep the display on while Bandstand is open' })).toBeChecked();

  // Not getByLabel — the only <select> on this page, so its role is
  // unambiguous without relying on label-association matching.
  const languageSelect = page.getByRole('combobox');
  await expect(languageSelect).toHaveValue('en');
  await languageSelect.selectOption('de');

  // Reflected app-wide immediately, not just on this control — the header's
  // own "Log out" button text changes too, since both read the same active
  // language (GlobalPrefsEffects.tsx applies it once, for everything).
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveValue('de');
});
