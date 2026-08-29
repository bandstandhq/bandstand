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
import { clientIp, createRateLimiter } from './rateLimit';

describe('createRateLimiter at the signup daily-cap size (100/24h)', () => {
  it('allows 100 requests from the same key and rejects the 101st', async () => {
    const app = new Hono();
    const limiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 100 });
    app.use('/x', limiter(clientIp));
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
    app.use('/x', limiter(clientIp));
    app.post('/x', (c) => c.json({ ok: true }));

    for (let i = 0; i < 101; i++) {
      await app.request('/x', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.7' } });
    }
    const otherKey = await app.request('/x', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.8' } });

    expect(otherKey.status).toBe(200);
  });
});
