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

/** A short, unique-per-run token — so one test run's throwaway data never collides with the next's. */
function freshToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A fresh, never-seen-before address — one test run's temp users don't collide with the next's. */
export function freshEmail(prefix: string) {
  return `${prefix}-${freshToken()}@example.test`;
}

/** A fresh, never-seen-before name for other throwaway records (setlists, invite labels, ...). */
export function freshName(prefix: string) {
  return `${prefix}-${freshToken()}`;
}

/** Reads the logged-in user's active band id off the dashboard's Repertoire link. */
export async function getActiveBandId(page: Page): Promise<string> {
  const href = await page.getByRole('link', { name: 'Repertoire' }).getAttribute('href');
  const match = href?.match(/\/bands\/([^/]+)\/repertoire/);
  if (!match) throw new Error(`Could not read active band id from Repertoire link href: ${href}`);
  return match[1]!;
}

/** Navigates from the dashboard into Stage Mode for the Nth item of a named seeded setlist. */
export async function enterStageMode(page: Page, bandId: string, setlistName: string, itemIndex: number) {
  await page.goto(`/bands/${bandId}/setlists`);
  // Board view's cards aren't <li>s, and a user's saved view-mode
  // preference (persisted from earlier manual testing) can make it the
  // default — force list view so the layout this helper expects is
  // consistent regardless of that saved preference.
  const switchToListView = page.getByRole('button', { name: 'List view' });
  if (await switchToListView.isVisible().catch(() => false)) {
    await switchToListView.click();
  }
  await page.locator('li', { hasText: setlistName }).getByRole('link', { name: 'Open' }).click();
  await page.getByRole('link', { name: 'Play' }).nth(itemIndex).click();
  await page.waitForURL(/\/stage\//);
}

/** Stage Mode's current item title/label — the page's only <h1>. */
export function stageModeHeading(page: Page) {
  return page.getByRole('heading', { level: 1 });
}
