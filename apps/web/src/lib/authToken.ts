// SPDX-License-Identifier: Apache-2.0
//
// Only relevant to a wrapped app (Capacitor/Tauri) — see auth-client.ts's
// header comment and docs/adr/0001-monorepo-thin-wrapper.md for why a
// wrapped WebView can't rely on the ordinary cookie session. A plain
// browser session never calls persistToken()/clearToken() at all, so a
// stored value here is itself evidence the caller is wrapped.
//
// KNOWN GAP vs. ADR-0001's "native secure storage" text: this uses plain
// localStorage, not a secure-storage native plugin — no such Capacitor
// plugin exists in this repo yet (see apps/mobile/package.json), and
// wiring one in is real native-dependency work (a new pnpm dependency,
// `npx cap sync android`, native review). localStorage already works fine
// in the Capacitor WebView today (serverConfig.ts's own server-override
// feature already uses it). The token is readable by any JS running in the
// wrapped bundle — a narrower posture than the HttpOnly cookie the browser
// path keeps — accepted as a deliberate, documented simplification for
// now. A real secure-storage plugin is a separate, future improvement, not
// implemented here.
const STORAGE_KEY = 'bandstand.authToken';

export function getStoredToken(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function persistToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable/full — nothing sensible to do; the session just
    // won't persist across restarts, same failure mode as if this never ran.
  }
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
