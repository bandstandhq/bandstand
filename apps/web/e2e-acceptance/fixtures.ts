// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

// Matches apps/server/src/seed/index.ts.
export const DEMO_OWNER_EMAIL = 'alice@bandstand.local';
export const DEMO_MEMBER_EMAIL = 'bob@bandstand.local';
export const DEMO_PASSWORD = 'bandstand-demo';

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard$/);
}

export async function signUp(
  page: Page,
  { name, email, password = DEMO_PASSWORD }: { name: string; email: string; password?: string },
  submitLabel = 'Sign up',
) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: submitLabel }).click();
}

/** A fresh, never-seen-before address — one test run's temp users don't collide with the next's. */
export function freshEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Reads the logged-in user's active band id off the dashboard's Repertoire link. */
export async function getActiveBandId(page: Page): Promise<string> {
  const href = await page.getByRole('link', { name: 'Repertoire' }).getAttribute('href');
  const match = href?.match(/\/bands\/([^/]+)\/repertoire/);
  if (!match) throw new Error(`Could not read active band id from Repertoire link href: ${href}`);
  return match[1]!;
}
