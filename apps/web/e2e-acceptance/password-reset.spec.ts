// SPDX-License-Identifier: Apache-2.0
//
// The forgot-password -> Mailpit -> reset-password flow end to end, against
// a real SMTP send and a real Mailpit inbox (docker/compose.yml) — not a
// stubbed mailer. Owns a throwaway signed-up user rather than reusing
// demo-owner/demo-member, since it changes that account's password (issue
// #81's "no acceptance test mutates the shared demo seed" rule extends to
// credentials, not just band content).
import { expect, test } from '@playwright/test';
import { deleteTestAccount, freshEmail, freshName, login } from './fixtures';
import { extractFirstLink, waitForEmail } from './mailpitTestClient';

test('requesting a reset, following the emailed link, and setting a new password retires the old one', async ({ page }) => {
  const email = freshEmail('password-reset');
  const name = freshName('Password Reset User');
  const oldPassword = 'original-password-123';
  const newPassword = 'brand-new-password-456';

  try {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);

    // Log back out — a user resetting a forgotten password starts unauthenticated.
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/login/);

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If that email exists in our system, check your inbox for a reset link.')).toBeVisible();

    const message = await waitForEmail(email, 'Reset your Bandstand password');
    const resetLink = extractFirstLink(message.HTML);

    // The link points at the server first (better-auth verifies the token,
    // then 302s to the client's own reset-password page) — following it is
    // exactly what a real click on the emailed link does.
    await page.goto(resetLink);
    await page.waitForURL(/\/reset-password\?token=/);

    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Your password has been changed.')).toBeVisible();

    await page.getByRole('link', { name: 'Go to log in' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText("Couldn't log in with those credentials.")).toBeVisible();

    await login(page, email, newPassword);
  } finally {
    await deleteTestAccount(email);
  }
});
