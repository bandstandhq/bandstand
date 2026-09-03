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

// The origin a wrapped native build's WebView presents for its own bundled assets — fixed by the
// platform's WebView engine, not by any self-hoster's domain, so this must be trusted for every
// deployment regardless of WEB_ORIGIN (ADR-0001: the client is meant to work against any
// self-hosted server, so one self-hoster's WEB_ORIGIN can't be the thing that makes the official
// app work). Capacitor Android sends `https://localhost` unless `server.androidScheme`/`hostname`
// is overridden in capacitor.config.ts (not done here — see that file); iOS and Tauri use their
// own fixed scheme instead. assertWebOriginIsRestricted's private-network check would reject
// `https://localhost` outright if a self-hoster tried adding it to WEB_ORIGIN themselves, which is
// exactly why this list is separate and always appended, not something WEB_ORIGIN can express.
export const WRAPPED_APP_ORIGINS = [
  'https://localhost', // Capacitor Android
  'capacitor://localhost', // Capacitor iOS
  'tauri://localhost', // Tauri (Linux/macOS)
  'https://tauri.localhost', // Tauri (Windows)
];
