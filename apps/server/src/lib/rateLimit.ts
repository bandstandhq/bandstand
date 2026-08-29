// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-memory sliding-window rate limiter. No Redis in the stack — self-
// hosting is meant to be one `docker compose up` — so this only works
// correctly for a single server instance; a horizontally-scaled deployment
// would need a shared store instead (tracked as a follow-up, not a bug in
// the current single-instance deployment model this targets).
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * Client IP: X-Forwarded-For first (a reverse-proxied self-hosted deploy
 * sits behind one), falling back to the direct socket peer. getConnInfo
 * only works when the request actually flowed through @hono/node-server's
 * serve() — it throws when a route is invoked in-process (e.g. `app.request()`
 * in tests), so that path is guarded rather than assumed available.
 */
export function clientIp(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;

  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The sliding-window core, decoupled from Hono's request/response cycle so
 * it can gate something other than "reject with 429" — e.g.
 * passwordResetRateLimit.ts needs to fall through to an identical-looking
 * success response instead, to avoid a rejection being distinguishable
 * from a real send. A rejected call never records a new timestamp (an
 * attacker spamming past the limit must not be able to keep extending
 * their own window indefinitely).
 */
export function createRateLimitChecker({ windowMs, max }: RateLimitOptions) {
  const hits = new Map<string, number[]>();

  return function check(key: string): boolean {
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) return false;

    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}

export function createRateLimiter(options: RateLimitOptions) {
  const check = createRateLimitChecker(options);

  return function rateLimit(keyFn: (c: Context) => string): MiddlewareHandler {
    return async (c, next) => {
      if (!check(keyFn(c))) {
        return c.json({ error: 'Too many attempts, try again later' }, 429);
      }
      await next();
    };
  };
}
