// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Layered protection specifically for POST /api/auth/request-password-reset
// — the one endpoint in this app that sends email off of nothing but an
// unauthenticated caller's say-so. An IP-only limit isn't enough (an
// attacker just rotates IPs, e.g. via a VPN), so this stacks three
// independent caps plus a short debounce:
//   - per account (email): the one an attacker can't route around by
//     changing address — this is the real backstop.
//   - per IP: catches one source hammering many different addresses.
//   - global: a hard ceiling on outbound password-reset mail per hour,
//     because the actual scarce resource being protected is the mail
//     provider's quota — better a temporary outage of this one feature
//     than every account locked out of it for a billing period.
//   - a 60s debounce per account: a duplicate click/submit doesn't count
//     as a second attempt and doesn't send a second email.
//
// Whichever of these (if any) rejects, the response must be byte-for-byte
// identical to better-auth's own success response — that's the only way a
// caller can't use "did this get rate-limited?" as an email-enumeration
// oracle on top of the ones better-auth's own handler already closes
// (constant-shape response, timing-attack simulation for unknown emails).
// This is registered as `app.use` on that one literal path, *before*
// app.ts's `/api/auth/*` catch-all — Hono runs middleware for a matching
// path in registration order, so a rejection here short-circuits before
// better-auth's handler (and therefore the mailer) ever runs; an allowed
// request just falls through to it via `next()` completely unmodified.
import type { MiddlewareHandler } from 'hono';
import { clientIp, createRateLimitChecker } from './rateLimit';

// Matches better-auth's own wording exactly (see
// node_modules/better-auth/dist/api/routes/password.mjs) — the whole point
// is that this is indistinguishable from the real thing.
const UNIFORM_RESPONSE = {
  status: true,
  message: 'If this email exists in our system, check your email for the reset link',
};

export interface PasswordResetRateLimitOptions {
  perAccountMax: number;
  perAccountWindowMs: number;
  perIpMax: number;
  perIpWindowMs: number;
  globalMax: number;
  globalWindowMs: number;
  dedupeWindowMs: number;
}

export function passwordResetRateLimit(options: PasswordResetRateLimitOptions): MiddlewareHandler {
  const checkAccount = createRateLimitChecker({ windowMs: options.perAccountWindowMs, max: options.perAccountMax });
  const checkIp = createRateLimitChecker({ windowMs: options.perIpWindowMs, max: options.perIpMax });
  const checkGlobal = createRateLimitChecker({ windowMs: options.globalWindowMs, max: options.globalMax });
  const lastSentAt = new Map<string, number>();

  return async (c, next) => {
    // .clone() — better-auth's own handler (further down the middleware
    // chain via app.ts's catch-all) still needs to read this same request's
    // body itself; a body stream can only be consumed once, so reading the
    // email here must not touch the original.
    const body: unknown = await c.req.raw
      .clone()
      .json()
      .catch(() => null);
    const email =
      body && typeof body === 'object' && 'email' in body && typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : null;
    if (!email) return next();

    const now = Date.now();
    const lastSent = lastSentAt.get(email);
    if (lastSent !== undefined && now - lastSent < options.dedupeWindowMs) {
      return c.json(UNIFORM_RESPONSE, 200);
    }

    if (!checkGlobal('global')) {
      console.warn(
        `[password-reset] global outbound email cap reached (${options.globalMax}/${options.globalWindowMs}ms) — rejecting further requests until the window clears`,
      );
      return c.json(UNIFORM_RESPONSE, 200);
    }
    if (!checkAccount(email)) {
      return c.json(UNIFORM_RESPONSE, 200);
    }
    if (!checkIp(clientIp(c))) {
      return c.json(UNIFORM_RESPONSE, 200);
    }

    lastSentAt.set(email, now);
    await next();
  };
}
