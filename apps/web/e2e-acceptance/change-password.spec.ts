// SPDX-License-Identifier: Apache-2.0
//
// Changing password from a logged-in session (AccountSettings.tsx),
// distinct from password-reset.spec.ts's forgot-password flow. The whole
// point of this one is proving `revokeOtherSessions: true` actually signs
// out every *other* session, not just rotating the current one — so it
// needs two real, independently-authenticated browser contexts standing in
// for two devices, not just one page. Owns a throwaway user, same reasoning
// as password-reset.spec.ts.
import { expect, test } from '@playwright/test';
import { deleteTestAccount, freshEmail, freshName, login } from './fixtures';

test('changing password from account settings signs out every other session but keeps this one', async ({
  page,
  browser,
}) => {
  const email = freshEmail('change-password');
  const name = freshName('Change Password User');
  const oldPassword = 'original-password-123';
  const newPassword = 'brand-new-password-456';

  const otherContext = await browser.newContext();
  try {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);

    // A second "device", its own independent session cookie.
    const otherPage = await otherContext.newPage();
    await login(otherPage, email, oldPassword);

    await page.goto('/settings');
    await page.getByLabel('Current password').fill(oldPassword);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText("Password changed. You've been signed out everywhere else.")).toBeVisible();

    // This session (the one that made the change) stays signed in.
    await page.reload();
    await expect(page).toHaveURL(/\/settings/);

    // The other, previously-logged-in session is now invalid.
    await otherPage.goto('/settings');
    await expect(otherPage).toHaveURL(/\/login/);

    // The old password no longer works; the new one does.
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/login/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText("Couldn't log in with those credentials.")).toBeVisible();

    await login(page, email, newPassword);
  } finally {
    await otherContext.close();
    await deleteTestAccount(email);
  }
});
