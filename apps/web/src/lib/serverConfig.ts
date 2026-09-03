// SPDX-License-Identifier: Apache-2.0
//
// The one place "which server does this client talk to" is decided — see
// docs/ARCHITECTURE.md's "server URL is configurable, not hardcoded" and
// ADR-0001 (the client is meant to be usable against any self-hosted
// server, not just the default one). A signed-out user can override the
// default from the login/signup screen (see ServerPicker.tsx) or clear back
// to it from there — never from account settings, which only ever displays
// it (you'd be discarding your own active session by switching).
//
// The *default* itself comes from one of three places, in order of how
// this file evolved:
//   1. `pnpm dev`: always the VITE_DEFAULT_SERVER_URL/VITE_DEFAULT_HOCUSPOCUS_URL
//      build-time vars (with networkHost.ts's LAN-loopback swap) — inert to
//      anything below by design, so a leftover value in a contributor's
//      browser profile can never make dev silently point somewhere
//      unexpected. See getActiveServerConfig()'s DEV branch.
//   2. A production build served by a Bandstand server (the normal case):
//      GET /config.json, fetched once at startup (initializeServerConfig(),
//      called from main.tsx before the app renders) — same-origin, since
//      the server also serves this build's static files (see
//      docs/SELF_HOSTING.md). This means changing the server's domain is a
//      restart, not a rebuild: nothing about the server's real URL is
//      baked into this bundle.
//   3. A wrapped app with no server of its own to fetch from at all
//      (Capacitor/Tauri load this same bundle from a `capacitor:`/`tauri:`
//      scheme) — initializeServerConfig() skips the fetch entirely there,
//      leaving the plain localhost fallback below in place; in practice a
//      user of a wrapped build always ends up in ServerPicker.tsx's custom-
//      server flow, since there's no real server at that fallback either.
import { clearToken } from './authToken';
import { withRuntimeHost } from './networkHost';

export interface ServerConfig {
  serverUrl: string;
  hocuspocusUrl: string;
}

const STORAGE_KEY = 'bandstand.serverConfig';

// Mutable: initializeServerConfig() below replaces this in place once
// GET /config.json resolves, so every existing synchronous reader (this
// module's own getActiveServerConfig(), ServerPicker.tsx's direct
// reference) keeps working unchanged — they just see the resolved value by
// the time they actually run, since main.tsx awaits initialization before
// the app tree ever renders.
export let DEFAULT_SERVER_CONFIG: ServerConfig = {
  serverUrl: withRuntimeHost(import.meta.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001'),
  hocuspocusUrl: withRuntimeHost(import.meta.env.VITE_DEFAULT_HOCUSPOCUS_URL ?? 'ws://localhost:3002'),
};

// Not a protocol check: Capacitor's iOS shell uses `capacitor://`, but its Android default is
// `https://localhost` (configurable, but that's the default) — indistinguishable from a real
// deployment by protocol alone. Both Capacitor and Tauri instead inject a global into any page
// they load, whether or not this bundle imports either SDK (neither is an apps/web dependency —
// see apps/mobile/README.md's "no feature logic" framing), so check for that directly.
export function isWrappedApp(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Capacitor' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

function isServerConfig(value: unknown): value is ServerConfig {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ServerConfig).serverUrl === 'string' &&
    typeof (value as ServerConfig).hocuspocusUrl === 'string'
  );
}

/**
 * Resolves the real default server config for a production browser deployment by fetching
 * GET /config.json from the same origin this build was served from. Must be awaited once at app
 * bootstrap (main.tsx), before anything reads DEFAULT_SERVER_CONFIG or renders — a no-op in dev
 * (see the DEV branch above) and in a wrapped app (no server listens at a capacitor:/tauri:
 * "origin", so there's nothing to fetch). Leaves DEFAULT_SERVER_CONFIG's existing fallback in
 * place on any failure (offline first load, misconfigured server) rather than blocking the app.
 */
export async function initializeServerConfig(): Promise<void> {
  if (import.meta.env.DEV || isWrappedApp()) return;

  try {
    const response = await fetch('/config.json');
    if (!response.ok) return;
    const parsed: unknown = await response.json();
    if (isServerConfig(parsed)) DEFAULT_SERVER_CONFIG = parsed;
  } catch {
    // Fetch itself failed (offline, network error) — keep the existing fallback.
  }
}

function readStoredOverride(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as ServerConfig).serverUrl === 'string' &&
      typeof (parsed as ServerConfig).hocuspocusUrl === 'string'
    ) {
      return parsed as ServerConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/** The server this client actually talks to right now. */
export function getActiveServerConfig(): ServerConfig {
  if (import.meta.env.DEV) return DEFAULT_SERVER_CONFIG;
  return readStoredOverride() ?? DEFAULT_SERVER_CONFIG;
}

export function isUsingCustomServer(): boolean {
  return !import.meta.env.DEV && readStoredOverride() !== null;
}

/** Persists the override and wipes every locally cached band doc/active-band
 * selection — content cached against one server is meaningless (and
 * potentially confusing, e.g. a stale activeBandId) against a different one. */
export function setServerOverride(config: ServerConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  wipeLocalDataForServerSwitch();
}

export function clearServerOverride(): void {
  localStorage.removeItem(STORAGE_KEY);
  wipeLocalDataForServerSwitch();
}

function wipeLocalDataForServerSwitch(): void {
  localStorage.removeItem('bandstand-active-band');
  // A bearer token issued by the old server must never be sent to the new
  // one — see authToken.ts. No-op for a plain browser session, which never
  // has one stored to begin with.
  clearToken();
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  void indexedDB.databases().then((databases) => {
    for (const entry of databases) {
      if (entry.name?.startsWith('bandstand:')) indexedDB.deleteDatabase(entry.name);
    }
  });
}
