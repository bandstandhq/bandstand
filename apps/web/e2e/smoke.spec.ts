// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

test('unauthenticated visit to /dashboard redirects to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('login page renders its form fields', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  // exact: true — otherwise this also matches the show/hide toggle button's
  // "Show password" aria-label as a substring.
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

// Both intercept the sign-in request client-side, so neither needs a real
// API server — the point is Login.tsx's own handling of what comes back
// (or doesn't), not whether better-auth itself works.
test('an unreachable server shows a network error, never the credentials message', async ({ page }) => {
  await page.route('**/api/auth/sign-in/email', (route) => route.abort('connectionrefused'));
  await page.goto('/login');
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByLabel('Password', { exact: true }).fill('whatever');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('reach the server', { exact: false })).toBeVisible();
  await expect(page.getByText("Couldn't log in with those credentials.")).not.toBeVisible();
});

test('an actual 401 rejection shows the credentials message, never the network one', async ({ page }) => {
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByLabel('Password', { exact: true }).fill('whatever');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText("Couldn't log in with those credentials.")).toBeVisible();
  await expect(page.getByText('reach the server', { exact: false })).not.toBeVisible();
});
