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

// How many reverse proxies sit in front of this server. 0 (the default)
// means never trust X-Forwarded-For at all: it's a request header the
// client fully controls, and unconditionally trusting it (as this used to)
// makes every IP-keyed rate limit in this app decorative — a client that
// sends a fresh, made-up value per request gets a fresh bucket per request.
// Set this to the real number of hops you run (typically 1 behind a single
// nginx/Caddy/Traefik) — see docs/SELF_HOSTING.md. Read once at module
// load, not per call (unlike push/config.ts, which deliberately reads
// process.env fresh every time) — this value is fixed for the life of the
// process, same as everything else about how the app is deployed.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 0);

/**
 * `clientIp`'s actual logic, taking `trustedHops` as a parameter instead of
 * reading the module-level constant — `clientIp` itself just delegates to
 * this with `TRUSTED_PROXY_HOPS`. Reading the env var once at module load
 * (see that constant's own comment) makes it untestable by mutating
 * `process.env` after the fact, so tests call this exported helper with an
 * explicit value instead.
 *
 * With `trustedHops > 0`, counts from the *right* of the X-Forwarded-For
 * chain: each proxy appends the address it received the request from, so
 * the rightmost entries are the ones your own infrastructure added and the
 * leftmost is whatever the client put there. With exactly one trusted hop,
 * the client's real address is the last entry. `getConnInfo` (the
 * fallback, and the only path at all when `trustedHops` is 0) only works
 * when the request actually flowed through @hono/node-server's serve() —
 * it throws when a route is invoked in-process (e.g. `app.request()` in
 * tests), so that path is guarded rather than assumed available.
 */
export function resolveClientIp(c: Context, trustedHops: number): string {
  if (trustedHops > 0) {
    const chain = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const candidate = chain[chain.length - trustedHops];
    if (candidate) return candidate;
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function clientIp(c: Context): string {
  return resolveClientIp(c, TRUSTED_PROXY_HOPS);
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
