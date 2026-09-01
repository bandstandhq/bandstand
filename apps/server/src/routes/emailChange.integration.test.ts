// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, hit through the actual, fully composed app (../app.ts) —
// same convention as members.integration.test.ts. Mail delivery itself
// (Mailpit, real link-following) is covered end to end at the acceptance
// level (change-email.spec.ts) — this proves the DB-backed state machine
// the mail flow sits on top of: what a pending change looks like, what
// confirming/cancelling actually does, and the two safety checks
// (trusted-origin, no enumeration leak) that don't need a real inbox to prove.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { pendingEmailChanges, users } from '../db/schema/index';
import { auth } from '../lib/auth';

const TRUSTED_ORIGIN = 'http://localhost:5173';

async function signUpTestUser() {
  const email = `test-email-change-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Email Change Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, email, token: result.token };
}

function initiate(token: string, newEmail: string, overrides: { confirmUrl?: string; cancelUrl?: string } = {}) {
  return app.request('/me/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-forwarded-for': randomUUID() },
    body: JSON.stringify({
      newEmail,
      confirmUrl: overrides.confirmUrl ?? `${TRUSTED_ORIGIN}/account/confirm-email-change`,
      cancelUrl: overrides.cancelUrl ?? `${TRUSTED_ORIGIN}/account/cancel-email-change`,
    }),
  });
}

function confirm(confirmToken: string) {
  return app.request('/me/email-change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: confirmToken }),
  });
}

function cancel(cancelToken: string) {
  return app.request('/me/email-change/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cancelToken }),
  });
}

describe('email change (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it('creates a pending change with both a confirm and a cancel token', async () => {
    const { userId, email, token } = await signUpTestUser();
    cleanupUserIds.push(userId);
    const newEmail = `test-email-change-new-${randomUUID()}@bandstand.local`;

    const res = await initiate(token, newEmail);
    expect(res.status).toBe(200);

    const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));
    expect(pending?.oldEmail).toBe(email);
    expect(pending?.newEmail).toBe(newEmail);
    expect(pending?.confirmToken).not.toBe(pending?.cancelToken);
  });

  it('confirming applies the change and marks the account verified, then the token is spent', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);
    const newEmail = `test-email-change-new-${randomUUID()}@bandstand.local`;

    await initiate(token, newEmail);
    const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));

    const res = await confirm(pending!.confirmToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: newEmail });

    const [updatedUser] = await db.select().from(users).where(eq(users.id, userId));
    expect(updatedUser?.email).toBe(newEmail);
    expect(updatedUser?.emailVerified).toBe(true);

    const [afterConfirm] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));
    expect(afterConfirm).toBeUndefined();

    // The confirm token doesn't work a second time — the row is gone.
    const second = await confirm(pending!.confirmToken);
    expect(second.status).toBe(400);
  });

  it('cancelling discards the pending change without touching the account email', async () => {
    const { userId, email, token } = await signUpTestUser();
    cleanupUserIds.push(userId);
    const newEmail = `test-email-change-new-${randomUUID()}@bandstand.local`;

    await initiate(token, newEmail);
    const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));

    const res = await cancel(pending!.cancelToken);
    expect(res.status).toBe(200);

    const [unchangedUser] = await db.select().from(users).where(eq(users.id, userId));
    expect(unchangedUser?.email).toBe(email);

    const [afterCancel] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));
    expect(afterCancel).toBeUndefined();

    // The confirm link from that same request is dead too, not just the
    // cancel link — the whole pending record is gone, either way round.
    const confirmAfterCancel = await confirm(pending!.confirmToken);
    expect(confirmAfterCancel.status).toBe(400);
  });

  it('rejects confirmUrl/cancelUrl on an untrusted origin', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    const res = await initiate(token, `test-email-change-new-${randomUUID()}@bandstand.local`, {
      confirmUrl: 'https://evil.example.test/account/confirm-email-change',
    });
    expect(res.status).toBe(400);

    const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, userId));
    expect(pending).toBeUndefined();
  });

  it('does not reveal whether newEmail already belongs to another account', async () => {
    const alice = await signUpTestUser();
    const bob = await signUpTestUser();
    cleanupUserIds.push(alice.userId, bob.userId);

    // Same response shape as a genuinely available address — see the
    // initiate handler's comment on why (account enumeration).
    const res = await initiate(alice.token, bob.email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });

    // But nothing was actually started — no pending row, alice's email untouched.
    const [pending] = await db.select().from(pendingEmailChanges).where(eq(pendingEmailChanges.userId, alice.userId));
    expect(pending).toBeUndefined();
  });

  it('a request for a nonexistent/unknown token is rejected, not a crash', async () => {
    const res = await confirm('not-a-real-token');
    expect(res.status).toBe(400);
  });

  it('is rate limited per account, same as change-password (accountActionRateLimit)', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    let last;
    for (let i = 0; i < 6; i++) {
      last = await initiate(token, `test-email-change-new-${randomUUID()}@bandstand.local`);
    }
    expect(last!.status).toBe(429);
  });
});
