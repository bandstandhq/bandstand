// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Layered protection for authenticated self-service account actions
// (change-password today, change-email next) — same spirit as
// passwordResetRateLimit.ts, but for an endpoint that already requires a
// valid session, not an anonymous caller. That changes what's worth
// protecting: there's no email-enumeration oracle to hide (the caller
// already knows their own account exists), so a plain 429 is fine here,
// unlike the uniform-success-response trick request-password-reset needs.
//
// What's still real: a stolen session cookie/bearer token lets an attacker
// call change-password without knowing the current password at all — its
// own `currentPassword` check is the only thing stopping them, and without
// a per-account cap they could hammer that check indefinitely trying to
// guess it before the legitimate owner notices. Per-IP catches one source
// doing this against many accounts. There's no third "global" tier here
// (unlike password-reset's mail-quota cap) — this endpoint sends no email,
// so there's no shared external resource to protect beyond the two above.
import type { MiddlewareHandler } from 'hono';
import { auth } from './auth';
import { clientIp, createRateLimitChecker } from './rateLimit';

export interface AccountActionRateLimitOptions {
  /** Only used to label the rejection log line, e.g. 'change-password'. */
  name: string;
  perAccountMax: number;
  perAccountWindowMs: number;
  perIpMax: number;
  perIpWindowMs: number;
}

export function accountActionRateLimit(options: AccountActionRateLimitOptions): MiddlewareHandler {
  const checkAccount = createRateLimitChecker({ windowMs: options.perAccountWindowMs, max: options.perAccountMax });
  const checkIp = createRateLimitChecker({ windowMs: options.perIpWindowMs, max: options.perIpMax });

  return async (c, next) => {
    // No session means better-auth's own handler will reject with its usual
    // 401 anyway — not this middleware's job to authenticate, only to rate
    // limit an already-identified caller.
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return next();

    if (!checkAccount(session.user.id) || !checkIp(clientIp(c))) {
      console.warn(`[${options.name}] rate limit hit for user ${session.user.id}`);
      return c.json({ error: 'Too many attempts, try again later' }, 429);
    }

    await next();
  };
}
