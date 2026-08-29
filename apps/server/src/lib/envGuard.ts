// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `docker/Dockerfile.server` sets NODE_ENV=production, so a self-hoster who
// copies .env.example into .env and never edits it would otherwise run a
// real production deployment with the placeholder credentials still active
// — a realistic failure mode, not a hypothetical one. Call this for any env
// var whose .env.example value is a dev-only placeholder; it hard-exits
// rather than silently starting up insecurely.
import { parseAllowedOrigins } from './corsOrigins';

export function assertNotDevPlaceholder(varName: string, value: string | undefined, placeholder: string): void {
  if (process.env.NODE_ENV === 'production' && value === placeholder) {
    console.error(
      `${varName} is still set to its development placeholder value. ` +
        `Set a real value before running in production.`,
    );
    process.exit(1);
  }
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
// (apps/server/src/app.ts, via corsOrigins.ts) must not reach production:
// a production deployment must resolve to exactly one origin, with no
// wildcard and no private-network address — the latter would most likely
// mean a WEB_ORIGIN accidentally left over from LAN testing.
export function assertProductionOriginIsRestricted(rawWebOrigin: string | undefined): void {
  if (process.env.NODE_ENV !== 'production') return;

  const origins = parseAllowedOrigins(rawWebOrigin);

  if (origins.length !== 1 || origins.some((origin) => origin.includes('*'))) {
    console.error(
      `WEB_ORIGIN must be exactly one non-wildcard origin in production (got: "${rawWebOrigin}").`,
    );
    process.exit(1);
    return;
  }

  const hostname = safeHostname(origins[0]!);
  if (!hostname || isPrivateNetworkHostname(hostname)) {
    console.error(
      `WEB_ORIGIN ("${origins[0]}") must be a real public origin in production, not a private/local network address.`,
    );
    process.exit(1);
  }
}
