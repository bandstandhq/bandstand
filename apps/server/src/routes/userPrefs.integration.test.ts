// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — the point is proving the upsert (insert-then-
// merge-patch) round-trip actually works against real row state.
import { randomUUID } from 'node:crypto';
import { DEFAULT_USER_PREFS } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `user-prefs-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Prefs Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function getPrefs(token: string) {
  return app.request('/me/prefs', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function patchPrefs(token: string, body: unknown) {
  return app.request('/me/prefs', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('GET/PATCH /me/prefs (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('returns the documented defaults before any row exists', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    const res = await getPrefs(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_USER_PREFS);
  });

  it('creates a row on first PATCH and merges on subsequent patches', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    const first = await patchPrefs(token, { personalTranspose: 2 });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ...DEFAULT_USER_PREFS, personalTranspose: 2 });

    const second = await patchPrefs(token, { boldText: true });
    expect(second.status).toBe(200);
    // personalTranspose from the first patch must survive the second's merge.
    expect(await second.json()).toEqual({ ...DEFAULT_USER_PREFS, personalTranspose: 2, boldText: true });

    const reread = await getPrefs(token);
    expect(await reread.json()).toEqual({ ...DEFAULT_USER_PREFS, personalTranspose: 2, boldText: true });
  });

  it('rejects an invalid patch value', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    const res = await patchPrefs(token, { textSize: 'huge' });
    expect(res.status).toBe(400);
  });
});
