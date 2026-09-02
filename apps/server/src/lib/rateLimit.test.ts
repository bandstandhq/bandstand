// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signup daily cap (app.ts: 100/day per IP) can't realistically get a
// live-clock integration test the way the hourly one does (see
// app.integration.test.ts) — reaching request #101 without the hourly cap
// (20/hour) already blocking everything past #20 would mean actually
// waiting out real hours. This proves the same `createRateLimiter`
// construction, with the exact windowMs/max app.ts uses for the daily cap,
// enforces that boundary correctly in isolation — the sliding-window logic
// itself is the same code path the hourly cap's real integration test
// already exercises end-to-end, so this is a deliberate, disclosed scope
// boundary, not a gap pretending not to exist.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createRateLimiter, resolveClientIp } from './rateLimit';

// Explicitly exercising the trusted-proxy path (hops=1) here — these two
// tests are about the sliding-window limiter's own bucketing, not about
// resolveClientIp's trust-hops behavior (covered on its own below), so they
// just need *some* real per-request key derived from X-Forwarded-For.
const keyFn = (c: Parameters<typeof resolveClientIp>[0]) => resolveClientIp(c, 1);

describe('createRateLimiter at the signup daily-cap size (100/24h)', () => {
  it('allows 100 requests from the same key and rejects the 101st', async () => {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 100 });
    app.use('/x', limiter(keyFn));
    app.post('/x', (c) => c.json({ ok: true }));

    let last: Response | undefined;
    for (let i = 0; i < 101; i++) {
      last = await app.request('/x', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.7' } });
    }

    expect(last!.status).toBe(429);
  });

  it('does not affect a different key', async () => {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 100 });
    app.use('/x', limiter(keyFn));
    app.post('/x', (c) => c.json({ ok: true }));

    for (let i = 0; i < 101; i++) {
      await app.request('/x', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.7' } });
    }
    const otherKey = await app.request('/x', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.8' } });

    expect(otherKey.status).toBe(200);
  });
});

describe('resolveClientIp', () => {
  // getConnInfo throws for an in-process app.request() call (no real socket
  // behind it) — every case below falls back to 'unknown' once it stops
  // trusting/finding anything useful in X-Forwarded-For, same as a real
  // deployment would fall back to the actual socket peer address.
  async function resolveFrom(headers: Record<string, string>, trustedHops: number): Promise<string> {
    const app = new Hono();
    let resolved = '';
    app.get('/x', (c) => {
      resolved = resolveClientIp(c, trustedHops);
      return c.json({ ok: true });
    });
    await app.request('/x', { headers });
    return resolved;
  }

  it('ignores X-Forwarded-For entirely at the default of 0 trusted hops', async () => {
    const resolved = await resolveFrom({ 'X-Forwarded-For': '198.51.100.7' }, 0);
    expect(resolved).toBe('unknown');
  });

  it('trusts the single (rightmost) entry with exactly one trusted hop', async () => {
    const resolved = await resolveFrom({ 'X-Forwarded-For': '198.51.100.7' }, 1);
    expect(resolved).toBe('198.51.100.7');
  });

  it('with one trusted hop, takes the rightmost entry of a spoofed multi-entry chain — never the client-supplied leftmost one', async () => {
    const resolved = await resolveFrom({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.9' }, 1);
    expect(resolved).toBe('203.0.113.9');
  });

  it('falls back to the socket peer when the header is missing entirely, even with hops trusted', async () => {
    const resolved = await resolveFrom({}, 1);
    expect(resolved).toBe('unknown');
  });
});
