// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WEB_ORIGIN is a comma-separated list of exact origins, not a single
// string — local dev often needs more than one at once (e.g. the
// contributor's own http://localhost:5173 plus their LAN address for
// testing on a phone, see CONTRIBUTING.md's "Testing on mobile devices"
// section). Never a wildcard outside NODE_ENV=development/test: envGuard.ts's
// assertWebOriginIsRestricted enforces that this otherwise
// resolves to exactly one, non-wildcard, non-private-network origin.
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
