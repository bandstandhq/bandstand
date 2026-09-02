// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fail closed. The guarded values are all published placeholders from
// .env.example, and tools/ensure-env.mjs copies that file into place
// automatically, so "the operator did not configure this" is the default
// state, not an unusual one. These guards used to key on
// NODE_ENV === 'production', which only ever protected
// docker/Dockerfile.server (the one place that sets it) and silently
// skipped every other way this server actually gets run in the real world —
// including `pnpm start`, the long-running-deployment path
// docs/SELF_HOSTING.md itself documents. Inverting the condition means a
// self-hoster who never thinks about NODE_ENV at all — the realistic
// default, not an edge case — gets the safe behavior automatically; only
// `pnpm dev` and running under a test runner opt back out.
import { parseAllowedOrigins } from './corsOrigins';

function isDevelopmentOrTest(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/** Call this for any env var whose .env.example value is a dev-only placeholder; it hard-exits rather than silently starting up insecurely. */
export function assertNotDevPlaceholder(varName: string, value: string | undefined, placeholder: string): void {
  if (!isDevelopmentOrTest() && value === placeholder) {
    console.error(
      `${varName} is still set to its development placeholder value. ` +
        `Set NODE_ENV=development to run locally with it, or set a real value before deploying.`,
    );
    process.exit(1);
  }
}

/**
 * A secret is more than "not the exact published placeholder" (that's
 * assertNotDevPlaceholder's job) — it also has to actually exist and be
 * long enough to resist guessing, which nothing checked before: an unset
 * BETTER_AUTH_SECRET quietly became `secret: undefined` in better-auth's
 * config, signing every session/JWT with no real secret at all.
 */
export function assertStrongSecret(varName: string, value: string | undefined, minLength = 32): void {
  if (isDevelopmentOrTest()) return;
  if (value !== undefined && value.length >= minLength) return;

  console.error(
    value === undefined
      ? `${varName} is not set. Generate one with \`openssl rand -base64 32\` and set it before deploying.`
      : `${varName} is only ${value.length} characters long — it needs at least ${minLength}. ` +
          `Generate one with \`openssl rand -base64 32\`.`,
  );
  process.exit(1);
}

// Loopback, RFC1918/link-local IPv4, mDNS, and IPv6 loopback/unique-local/
// link-local — the address ranges a LAN-testing WEB_ORIGIN (see
// CONTRIBUTING.md's "Testing on mobile devices" section) would plausibly
// use, and none of which a real production origin should ever be.
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.local$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/, // IPv6 unique local, fc00::/7
  /^fe80:/, // IPv6 link-local
];

function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

function safeHostname(origin: string): string | undefined {
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

// The dev-only relaxation that lets WEB_ORIGIN carry a comma-separated list
// (apps/server/src/app.ts, via corsOrigins.ts) must not reach a real
// deployment: it must resolve to exactly one origin, with no wildcard and
// no private-network address — the latter would most likely mean a
// WEB_ORIGIN accidentally left over from LAN testing. Renamed from
// assertProductionOriginIsRestricted: same reasoning as the rest of this
// file, this was never actually production-specific, just gated on it.
export function assertWebOriginIsRestricted(rawWebOrigin: string | undefined): void {
  if (isDevelopmentOrTest()) return;

  const origins = parseAllowedOrigins(rawWebOrigin);

  if (origins.length !== 1 || origins.some((origin) => origin.includes('*'))) {
    console.error(`WEB_ORIGIN must be exactly one non-wildcard origin (got: "${rawWebOrigin}").`);
    process.exit(1);
    return;
  }

  const hostname = safeHostname(origins[0]!);
  if (!hostname || isPrivateNetworkHostname(hostname)) {
    console.error(
      `WEB_ORIGIN ("${origins[0]}") must be a real public origin, not a private/local network address. ` +
        `Set NODE_ENV=development if this really is local/LAN testing.`,
    );
    process.exit(1);
  }
}
