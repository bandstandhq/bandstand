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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, MAX_REQUEST_BODY_BYTES } from './app';
import { db } from './db/client';
import { users } from './db/schema/index';
import { auth } from './lib/auth';

async function signUpTestUser() {
  const email = `test-app-mw-${randomUUID()}@bandstand.local`;
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

describe('CORS for wrapped native app origins (integration)', () => {
  // WEB_ORIGIN in this test env is the local-dev default (http://localhost:5173, see
  // corsOrigins.ts) — none of these origins come from that. Confirms WRAPPED_APP_ORIGINS is
  // always allowed regardless of WEB_ORIGIN, which is the whole point: an origin a self-hoster
  // never configured must still work for the official mobile/desktop apps (see corsOrigins.ts's
  // comment on WRAPPED_APP_ORIGINS and ADR-0001).
  it.each(['https://localhost', 'capacitor://localhost', 'tauri://localhost', 'https://tauri.localhost'])(
    'echoes %s back as an allowed origin',
    async (origin) => {
      const res = await app.request('/health', { headers: { Origin: origin } });

      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    },
  );

  it('does not allow an arbitrary unrelated origin', async () => {
    const res = await app.request('/health', { headers: { Origin: 'https://evil.example' } });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /api/auth/sign-up/email rate limiting (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it(
    // The actual regression test for the X-Forwarded-For trust fix: with
    // TRUST_PROXY_HOPS unset (the default, 0), the header is never trusted
    // at all — a fresh, made-up value per request must not buy a fresh
    // bucket per request. Before the fix, this loop's 25 distinct spoofed
    // IPs each got their own limiter bucket and every request succeeded.
    'rejects the 21st signup within an hour even when every request spoofs a different X-Forwarded-For, because the header is ignored by default',
    async () => {
      let last: Response | undefined;

      for (let i = 0; i < 25; i++) {
        const spoofedIp = `${randomInt(256)}.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
        last = await app.request('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': spoofedIp },
          body: JSON.stringify({
            email: `test-signup-spoof-${randomUUID()}@bandstand.local`,
            password: 'test-password-123',
            name: 'Signup Spoof Tester',
          }),
        });
        if (isSuccessResponse(last)) {
          const body = (await last.clone().json()) as { user?: { id: string } };
          if (body.user?.id) cleanupUserIds.push(body.user.id);
        }
      }

      expect(last!.status).toBe(429);
    },
    // 25 real signups, each doing real password hashing plus a DB round
    // trip — comfortably fits in vitest's 5s default on a quiet machine,
    // but wants headroom under load.
    20_000,
  );
});

describe('POST /api/auth/sign-up/email rate limiting with TRUST_PROXY_HOPS=1 (integration)', () => {
  const cleanupUserIds: string[] = [];
  const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;
  // TRUST_PROXY_HOPS is read once, at module load, by rateLimit.ts (see its
  // own comment on why) — a plain `process.env` mutation in beforeAll runs
  // long after app.ts (and everything it imports, including rateLimit.ts)
  // has already been evaluated by the top-level `import` above, so it
  // would have no effect on the already-registered signup limiter. Setting
  // the env var *and* resetting the module registry *and* re-importing
  // app.ts, all inside beforeAll, gets a genuinely fresh app instance whose
  // signup limiter was built with the new value.
  let appWithTrustedProxy: typeof import('./app').app;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    vi.resetModules();
    ({ app: appWithTrustedProxy } = await import('./app'));
  });

  afterAll(async () => {
    if (originalTrustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it(
    'rejects the 21st signup from the same (trusted, single-hop) IP within an hour — registration has no invite gate, so this is the only thing standing between an open /signup and account-farming',
    async () => {
      const ip = `203.0.${randomUUID().slice(0, 3)}.1`; // a fresh /24-ish per test run, isolated from other tests hitting this same limiter instance
      let last: Response | undefined;

      for (let i = 0; i < 21; i++) {
        last = await appWithTrustedProxy.request('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
          body: JSON.stringify({
            email: `test-signup-rate-${randomUUID()}@bandstand.local`,
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
    },
    // 21 real signups, each doing real password hashing plus a DB round
    // trip — comfortably fits in vitest's 5s default on a quiet machine,
    // but wants headroom under load.
    15_000,
  );
});

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function isSuccessResponse(res: Response): boolean {
  return res.status >= 200 && res.status < 300;
}
