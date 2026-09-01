// SPDX-License-Identifier: Apache-2.0
//
// The hybrid confirm-new/notify-old email-change flow, against real SMTP
// sends and a real Mailpit inbox — same convention as password-reset.spec.ts.
// Two scenarios: the happy path (new address confirms, change applies) and
// the abuse case the notice-to-old-address exists for (someone cancels a
// change they didn't request, using only the old inbox).
import { expect, test } from '@playwright/test';
import { deleteTestAccount, freshEmail, freshName, login } from './fixtures';
import { extractFirstLink, waitForEmail } from './mailpitTestClient';

test('confirming from the new address applies the email change', async ({ page }) => {
  const email = freshEmail('change-email-confirm');
  const newEmail = freshEmail('change-email-confirm-new');
  const name = freshName('Change Email User');
  const password = 'change-email-password-1';

  try {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);

    await page.goto('/settings');
    await expect(page.getByText(`Current: ${email}`)).toBeVisible();
    await page.getByLabel('New email address').fill(newEmail);
    await page.getByRole('button', { name: 'Send confirmation' }).click();
    await expect(page.getByText(/we've sent a confirmation link/)).toBeVisible();

    const confirmMessage = await waitForEmail(newEmail, 'Confirm your new Bandstand email address');
    const confirmLink = extractFirstLink(confirmMessage.HTML);

    await page.goto(confirmLink);
    await expect(page.getByText(`is now ${newEmail}`)).toBeVisible();

    // Reflected immediately for the still-logged-in session that made the change.
    await page.goto('/settings');
    await expect(page.getByText(`Current: ${newEmail}`)).toBeVisible();

    // The account is now reachable at the new address, not the old one.
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/login/);
    await login(page, newEmail, password);
  } finally {
    await deleteTestAccount(newEmail);
    await deleteTestAccount(email);
  }
});

test('cancelling from the old address discards a change nobody at the account requested', async ({
  page,
  browser,
}) => {
  const email = freshEmail('change-email-cancel');
  const attackerEmail = freshEmail('change-email-cancel-attacker');
  const name = freshName('Change Email Cancel User');
  const password = 'change-email-cancel-password-1';

  const attackerContext = await browser.newContext();
  try {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);

    // Stands in for a hijacked session on a second device, trying to move
    // the account to an address the real owner doesn't control.
    const attackerPage = await attackerContext.newPage();
    await login(attackerPage, email, password);
    await attackerPage.goto('/settings');
    await attackerPage.getByLabel('New email address').fill(attackerEmail);
    await attackerPage.getByRole('button', { name: 'Send confirmation' }).click();
    await expect(attackerPage.getByText(/we've sent a confirmation link/)).toBeVisible();

    // The real owner never asked for this, but gets the notice regardless.
    const noticeMessage = await waitForEmail(email, 'Your Bandstand email address is changing');
    const cancelLink = extractFirstLink(noticeMessage.HTML);

    await page.goto(cancelLink);
    await expect(page.getByText('cancelled')).toBeVisible();

    // The account's email is untouched — still reachable at the original address.
    await page.reload();
    await page.goto('/settings');
    await expect(page.getByText(`Current: ${email}`)).toBeVisible();
  } finally {
    await attackerContext.close();
    await deleteTestAccount(email);
  }
});
