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

// Every signup case below intercepts the sign-up request client-side, same
// reasoning as the login tests above. Each fills valid-looking values so the
// browser's own HTML validation never blocks the submit before the request
// is even made — the only thing under test is SignupForm's handling of the
// response.
async function fillSignupForm(page: import('@playwright/test').Page) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Someone');
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByLabel('Password', { exact: true }).fill('a-fine-password');
}

test('an unreachable server shows a network error on signup, never the generic one', async ({ page }) => {
  await page.route('**/api/auth/sign-up/email', (route) => route.abort('connectionrefused'));
  await fillSignupForm(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('reach the server', { exact: false })).toBeVisible();
  await expect(page.getByText("Couldn't create an account with those details.")).not.toBeVisible();
});

test('a rate-limit response says so, distinct from every other signup failure', async ({ page }) => {
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ message: 'Too many requests' }) }),
  );
  await fillSignupForm(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Too many attempts', { exact: false })).toBeVisible();
});

test('an invalid-email response names the email, not a generic failure', async ({ page }) => {
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_EMAIL', message: 'Invalid email' }) }),
  );
  await fillSignupForm(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('valid email address', { exact: false })).toBeVisible();
});

test('a password-too-short response names the password, not a generic failure', async ({ page }) => {
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PASSWORD_TOO_SHORT', message: 'Password too short' }),
    }),
  );
  await fillSignupForm(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Password is too short', { exact: false })).toBeVisible();
});

// The privacy-critical case: whether an address is already registered must
// never be observable from the message shown — it gets the exact same
// generic wording as an unrecognized/unexpected failure, never its own text.
test('an already-registered email shows the same generic message as an unexpected failure, never reveals it exists', async ({
  page,
}) => {
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists. Use another email.' }),
    }),
  );
  await fillSignupForm(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  // Scoped to the error message itself (not the whole page) — the page's
  // own "Already have an account?" link legitimately contains "already",
  // which isn't the leak this test guards against.
  const errorMessage = page.locator('p.text-destructive');
  await expect(errorMessage).toHaveText("Couldn't create an account with those details.");
});
