// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { deleteUserByEmail, withDb } from './testDb';

const SERVER_URL = process.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001';

// Matches apps/server/src/seed/index.ts. Only used to log in as an already
// -existing demo user or to add one as a member of a throwaway band — no
// acceptance test reads or writes demo-band/second-fiddle's own content
// (see issue #81).
export const DEMO_OWNER_EMAIL = 'alice@bandstand.local';
export const DEMO_MEMBER_EMAIL = 'bob@bandstand.local';
export const DEMO_PASSWORD = 'bandstand-demo';

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // /dashboard itself only resolves which band to show and forwards there
  // (DashboardRedirect, see routes/bandRouteConfig.ts) — /dashboard$ alone
  // would match that fleeting intermediate URL for a user with any bands.
  await page.waitForURL(/\/(bands\/.+\/dashboard|dashboard)$/);
}

export async function signUp(
  page: Page,
  { name, email, password = DEMO_PASSWORD }: { name: string; email: string; password?: string },
  submitLabel = 'Sign up',
) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: submitLabel }).click();
}

/** A short, unique-per-run token — so one test run's throwaway data never collides with the next's. */
function freshToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A fresh, never-seen-before address — one test run's temp users don't
 * collide with the next's. Always starts with `test-`: a cleanup command
 * needs to recognize "this account belongs to a test run" by what it looks
 * like, not by knowing every other account in the database — see
 * apps/server/src/scripts/cleanupTestAccounts.ts.
 */
export function freshEmail(prefix: string) {
  return `test-${prefix}-${freshToken()}@example.test`;
}

/**
 * A fresh, never-seen-before name for other throwaway records (bands,
 * setlists, invite labels, ...). Always starts with `test-`, same reasoning
 * as `freshEmail` — a band created through this is what
 * `cleanupTestAccounts.ts` matches on by name/slug.
 */
export function freshName(prefix: string) {
  return `test-${prefix}-${freshToken()}`;
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
  // The row itself is now also a (stretched, invisible) link to the same
  // destination, with its own accessible name ("Open <setlist name>") — an
  // exact match on the small visible "Open" link keeps this from matching
  // both.
  await page.locator('li', { hasText: setlistName }).getByRole('link', { name: 'Open', exact: true }).click();
  // A setlist opens in its calm read view by default (no song pool, no
  // edit affordances) — each item's whole row is a link straight into
  // Stage Mode, matched here by its href rather than any edit-mode-only
  // container class.
  await page.locator('main a[href*="/stage/"]').nth(itemIndex).click();
  await page.waitForURL(/\/stage\//);
}

/** Stage Mode's current item title/label — the page's only <h1>. */
export function stageModeHeading(page: Page) {
  return page.getByRole('heading', { level: 1 });
}

export interface ThrowawayBand {
  bandId: string;
  name: string;
}

/**
 * Creates a fresh, single-test-owned band via the real `POST /bands` route
 * — the caller becomes its owner. Pair with `deleteThrowawayBand` in the
 * test's own `finally` so nothing is left behind. This is the standard
 * setup for any acceptance test that needs a band to write into — no
 * acceptance test reads or writes the shared demo-band/second-fiddle seed
 * data (issue #81: a shared, mutated-in-place fixture meant one test's
 * leftovers could break another's assumptions about what's there).
 */
export async function createThrowawayBand(token: string, namePrefix: string): Promise<ThrowawayBand> {
  const name = freshName(namePrefix);
  const res = await fetch(`${SERVER_URL}/bands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create throwaway band: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return { bandId: body.id, name };
}

/** Deletes a band created by `createThrowawayBand` — must be called by its owner. Cascades to memberships, invites, and its band doc. */
export async function deleteThrowawayBand(token: string, bandId: string): Promise<void> {
  await fetch(`${SERVER_URL}/bands/${bandId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Deletes a user created via `freshEmail` — pair with any spec that signs a
 * fresh user up (session-isolation, password-reset, account-settings,
 * invite-single-use, removed-member, non-member-access, ...) in the test's
 * own `finally`, the same way a throwaway band gets deleted via
 * `deleteThrowawayBand`. There's no REST route for this (self-account
 * deletion isn't a feature this app has), so — like `removed-member.spec.ts`
 * already does for its own cleanup — this goes straight to Postgres via
 * `testDb.ts`. See `deleteUserByEmail`'s own doc comment for why that's
 * still safe to call on an arbitrary email.
 */
export async function deleteTestAccount(email: string): Promise<void> {
  await withDb((client) => deleteUserByEmail(client, email));
}
