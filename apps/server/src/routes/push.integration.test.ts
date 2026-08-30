// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — proving the subscribe/unsubscribe/prefs round
// trips actually persist and merge against real row state, same bar as
// userPrefs.integration.test.ts.
import { randomUUID } from 'node:crypto';
import { DEFAULT_PUSH_TRIGGERS } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { pushSubscriptions, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-push-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Push Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function subscribe(token: string, body: unknown) {
  return app.request('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function unsubscribe(token: string, endpoint: string) {
  return app.request(`/push/subscribe/${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

function patchPref(token: string, body: unknown) {
  return app.request('/push/prefs', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('push subscribe/unsubscribe/prefs (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('subscribing stores a row, and unsubscribing removes it', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);
    const endpoint = `https://push.example.test/${randomUUID()}`;

    const subRes = await subscribe(token, {
      endpoint,
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      deviceLabel: 'Test device',
    });
    expect(subRes.status).toBe(200);

    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row).toMatchObject({ userId, p256dh: 'p256dh-value', auth: 'auth-value', deviceLabel: 'Test device' });

    const unsubRes = await unsubscribe(token, endpoint);
    expect(unsubRes.status).toBe(200);

    const [afterDelete] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(afterDelete).toBeUndefined();
  });

  it('re-subscribing the same endpoint updates the existing row instead of erroring', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);
    const endpoint = `https://push.example.test/${randomUUID()}`;

    await subscribe(token, { endpoint, keys: { p256dh: 'first', auth: 'first' } });
    const res = await subscribe(token, { endpoint, keys: { p256dh: 'second', auth: 'second' } });
    expect(res.status).toBe(200);

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, p256dh: 'second', auth: 'second' });
  });

  it("unsubscribing another user's endpoint is a no-op", async () => {
    const owner = await signUpTestUser();
    const attacker = await signUpTestUser();
    cleanupUserIds.push(owner.userId, attacker.userId);
    const endpoint = `https://push.example.test/${randomUUID()}`;

    await subscribe(owner.token, { endpoint, keys: { p256dh: 'p', auth: 'a' } });
    await unsubscribe(attacker.token, endpoint);

    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row).toBeDefined();
  });

  it('toggling one trigger leaves the others at their defaults, and preserves earlier toggles', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    const first = await patchPref(token, { trigger: 'eventCreated', enabled: true });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ pushTriggers: { ...DEFAULT_PUSH_TRIGGERS, eventCreated: true } });

    const second = await patchPref(token, { trigger: 'pollCreated', enabled: true });
    expect(await second.json()).toEqual({
      pushTriggers: { ...DEFAULT_PUSH_TRIGGERS, eventCreated: true, pollCreated: true },
    });
  });
});
