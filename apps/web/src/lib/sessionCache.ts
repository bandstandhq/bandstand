// SPDX-License-Identifier: Apache-2.0
//
// A confirmed session persisted here is what lets RequireAuth.tsx tell
// "the network check failed because we're offline" apart from "the server
// said no session" — better-auth's own session store lives only in memory
// (a nanostore), so it's empty again after every full page reload, and a
// fetch that fails outright (no connectivity at all, not even a cached
// response) resolves to `data: null` exactly like a real logged-out
// response would. Without something surviving the reload, a previously
// signed-in user who reloads while offline gets bounced to /login despite
// this app's whole IndexedDB-backed offline story otherwise working fine.
const STORAGE_KEY = 'bandstand.sessionCache';

export function getCachedSession<T>(): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setCachedSession(session: unknown): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (Safari private mode etc.) — the offline-reload
    // fallback below just won't have anything to work with; no worse than
    // before this module existed.
  }
}

export function clearCachedSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
