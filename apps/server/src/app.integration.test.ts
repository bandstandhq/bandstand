// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Proves the app-wide middleware in app.ts (the global error handler and
// the body-size limit) actually run on the real request path — not just
// that the code exists, since every route's own integration test used to
// call that route's sub-router directly (e.g. `bandsRoute.request(...)`),
// which never went through app.ts's `cors`/`bodyLimit`/`onError` at all.
// See the August 2026 security review's finding 8 and its follow-up: a
// fix registered only on the composed app is unverified until a test
// actually exercises that composition, not a fragment of it.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app, MAX_REQUEST_BODY_BYTES } from './app';
import { db } from './db/client';
import { users } from './db/schema/index';
import { auth } from './lib/auth';

async function signUpTestUser() {
  const email = `app-mw-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'App Middleware Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

describe('app-wide middleware (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('answers a schema validation failure with 400 and a minimal path/code list, not a generic 500', async () => {
    const { userId, token } = await signUpTestUser();
    cleanupUserIds.push(userId);

    // POST /bands requires `name` (createBandInputSchema) — an empty body
    // fails that schema's .parse() inside the route handler. Without
    // app.ts's onError, this reaches Hono's own default handler instead and
    // comes back as a generic 500 (exactly what routes calling their
    // sub-router directly, bypassing app.ts, used to observe).
    const res = await app.request('/bands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { path: unknown[]; code: string }[] };
    expect(body.error).toBe('Invalid request');
    // Only path and code — never the offending value some Zod issue codes
    // would otherwise include (see app.ts's own comment on why).
    expect(body.details).toEqual([{ path: ['name'], code: 'invalid_type' }]);
  });

  it('rejects a request body over the configured size limit with 413, before any route handler runs', async () => {
    // Deliberately no Authorization header — the body limit must reject
    // this before auth (or any route logic) is ever reached, proving it's
    // genuinely global middleware, not something layered inside one route.
    const oversized = 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1);

    const res = await app.request('/bands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    });

    expect(res.status).toBe(413);
  });
});

describe('POST /api/auth/sign-up/email rate limiting (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects the 21st signup from the same IP within an hour — registration has no invite gate, so this is the only thing standing between an open /signup and account-farming', async () => {
    const ip = `203.0.${randomUUID().slice(0, 3)}.1`; // a fresh /24-ish per test run, isolated from other tests hitting this same limiter instance
    let last: Response | undefined;

    for (let i = 0; i < 21; i++) {
      last = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({
          email: `signup-rate-${randomUUID()}@bandstand.local`,
          password: 'test-password-123',
          name: 'Signup Rate Tester',
        }),
      });
      if (isSuccessResponse(last)) {
        const body = (await last.clone().json()) as { user?: { id: string } };
        if (body.user?.id) cleanupUserIds.push(body.user.id);
      }
    }

    expect(last!.status).toBe(429);
  });
});

function isSuccessResponse(res: Response): boolean {
  return res.status >= 200 && res.status < 300;
}
