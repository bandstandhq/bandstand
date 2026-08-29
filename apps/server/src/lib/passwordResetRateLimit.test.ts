// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A plain unit test, not an integration one — the whole point of this
// middleware is deciding whether to call `next()` at all, so a fake
// downstream handler that counts its own invocations is a more direct
// proof than exercising the real better-auth endpoint (already covered by
// app.integration.test.ts's pattern for other app.ts-level middleware).
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { passwordResetRateLimit, type PasswordResetRateLimitOptions } from './passwordResetRateLimit';

const SUCCESS_BODY = {
  status: true,
  message: 'If this email exists in our system, check your email for the reset link',
};

function buildApp(overrides: Partial<PasswordResetRateLimitOptions> = {}) {
  const options: PasswordResetRateLimitOptions = {
    perAccountMax: 3,
    perAccountWindowMs: 60_000,
    perIpMax: 10,
    perIpWindowMs: 60_000,
    globalMax: 100,
    globalWindowMs: 60_000,
    dedupeWindowMs: 60_000,
    ...overrides,
  };
  const app = new Hono();
  let handlerCalls = 0;
  app.use('/request-password-reset', passwordResetRateLimit(options));
  app.post('/request-password-reset', (c) => {
    handlerCalls++;
    return c.json(SUCCESS_BODY, 200);
  });
  return { app, getHandlerCalls: () => handlerCalls };
}

function req(app: Hono, email: string, ip = '203.0.113.1') {
  return app.request('/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email }),
  });
}

describe('passwordResetRateLimit', () => {
  it('lets a request under every limit reach the real handler', async () => {
    const { app, getHandlerCalls } = buildApp();
    const res = await req(app, 'alice@example.test');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS_BODY);
    expect(getHandlerCalls()).toBe(1);
  });

  it('blocks the 4th request for the same account within the window without touching the handler', async () => {
    // dedupeWindowMs: 0 — otherwise the debounce (a separate, tighter check
    // that runs first) would itself block every repeat call for this same
    // address before the account counter ever got exercised.
    const { app, getHandlerCalls } = buildApp({ perAccountMax: 3, dedupeWindowMs: 0 });
    let last;
    for (let i = 0; i < 4; i++) {
      // Different IPs each time so only the per-account limit is in play.
      last = await req(app, 'bob@example.test', `203.0.113.${i}`);
    }
    expect(last!.status).toBe(200);
    expect(await last!.json()).toEqual(SUCCESS_BODY);
    expect(getHandlerCalls()).toBe(3);
  });

  it('blocks the 11th request from the same IP within the window without touching the handler', async () => {
    const { app, getHandlerCalls } = buildApp({ perIpMax: 10, perAccountMax: 1000 });
    let last;
    for (let i = 0; i < 11; i++) {
      last = await req(app, `user${i}@example.test`, '203.0.113.9');
    }
    expect(last!.status).toBe(200);
    expect(await last!.json()).toEqual(SUCCESS_BODY);
    expect(getHandlerCalls()).toBe(10);
  });

  it('stops calling the handler once the global cap is reached, regardless of account or IP', async () => {
    const { app, getHandlerCalls } = buildApp({ globalMax: 5, perAccountMax: 1000, perIpMax: 1000 });
    let last;
    for (let i = 0; i < 6; i++) {
      last = await req(app, `user${i}@example.test`, `203.0.113.${i}`);
    }
    expect(last!.status).toBe(200);
    expect(await last!.json()).toEqual(SUCCESS_BODY);
    expect(getHandlerCalls()).toBe(5);
  });

  it('does not call the handler a second time for the same account inside the debounce window', async () => {
    const { app, getHandlerCalls } = buildApp({ dedupeWindowMs: 60_000, perAccountMax: 1000 });
    const first = await req(app, 'carol@example.test');
    const second = await req(app, 'carol@example.test');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(SUCCESS_BODY);
    expect(getHandlerCalls()).toBe(1);
  });

  it('a rejection is byte-for-byte indistinguishable from success — same status, same body', async () => {
    const { app } = buildApp({ perAccountMax: 1 });
    const allowed = await req(app, 'dana@example.test', '203.0.113.50');
    const rejected = await req(app, 'dana@example.test', '203.0.113.51'); // different IP: only the account limit trips

    expect(rejected.status).toBe(allowed.status);
    expect(await rejected.json()).toEqual(await allowed.json());
  });

  it('does not rate-limit a request with no email — lets it through for better-auth to reject on its own validation', async () => {
    const { app, getHandlerCalls } = buildApp();
    const res = await app.request('/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(getHandlerCalls()).toBe(1);
  });
});
