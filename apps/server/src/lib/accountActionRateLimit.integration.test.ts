// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres (DATABASE_URL) — see vitest.integration.config.ts.
// Exercised through the real app.ts wiring on the actual better-auth path
// (/api/auth/change-password), not a synthetic Hono app — this middleware's
// whole point is deciding whether that specific, already-mounted route ever
// runs, so proving it against the real route is the only real proof.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { auth } from './auth';

async function signUpTestUser() {
  const email = `test-account-rate-limit-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Rate Limit Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { token: result.token };
}

function changePassword(token: string, ip: string, currentPassword = 'wrong-password') {
  return app.request('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ currentPassword, newPassword: 'irrelevant-new-password' }),
  });
}

describe('accountActionRateLimit on /api/auth/change-password (integration)', () => {
  it('lets attempts under the per-account cap reach the real handler (a real 400 for the wrong current password, not 429)', async () => {
    const { token } = await signUpTestUser();
    const res = await changePassword(token, '203.0.113.10');
    expect(res.status).not.toBe(429);
  });

  it('blocks the 6th change-password attempt for the same account within the window, even from different IPs', async () => {
    const { token } = await signUpTestUser();
    let last;
    for (let i = 0; i < 6; i++) {
      last = await changePassword(token, `203.0.113.${20 + i}`);
    }
    expect(last!.status).toBe(429);
  });

  it(
    'blocks the 16th change-password attempt from the same IP within the window, across different accounts',
    async () => {
      const ip = '203.0.113.99';
      let last;
      for (let i = 0; i < 16; i++) {
        const { token } = await signUpTestUser();
        last = await changePassword(token, ip);
      }
      expect(last!.status).toBe(429);
    },
    // 16 real sign-ups, each hashing a password with scrypt (see the August
    // 2026 review's password audit — a deliberately memory-hard, not fast,
    // KDF) — comfortably over the default 5s test timeout under any
    // concurrent load from the rest of the integration suite.
    30_000,
  );

  it('does not rate-limit an unauthenticated call — lets better-auth reject it on its own', async () => {
    const res = await changePassword('not-a-real-token', '203.0.113.200');
    expect(res.status).not.toBe(429);
  });
});
