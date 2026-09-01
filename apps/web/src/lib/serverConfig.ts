// SPDX-License-Identifier: Apache-2.0
//
// The one place "which server does this client talk to" is decided — see
// docs/ARCHITECTURE.md's "server URL is configurable, not hardcoded" and
// ADR-0001 (the client is meant to be usable against any self-hosted
// server, not just the default one). VITE_DEFAULT_SERVER_URL/
// VITE_DEFAULT_HOCUSPOCUS_URL (with networkHost.ts's LAN-loopback swap)
// remain the *default*; a signed-out user can override it from the login/
// signup screen (see ServerPicker.tsx) or clear back to the default from
// there — never from account settings, which only ever displays it (you'd
// be discarding your own active session by switching).
//
// Inert during `pnpm dev` by design: `getActiveServerConfig()` always
// returns the build-time default there, regardless of any stored override,
// so a leftover value in a contributor's browser profile can never make
// `pnpm dev` silently point somewhere unexpected.
import { withRuntimeHost } from './networkHost';

export interface ServerConfig {
  serverUrl: string;
  hocuspocusUrl: string;
}

const STORAGE_KEY = 'bandstand.serverConfig';

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  serverUrl: withRuntimeHost(import.meta.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001'),
  hocuspocusUrl: withRuntimeHost(import.meta.env.VITE_DEFAULT_HOCUSPOCUS_URL ?? 'ws://localhost:3002'),
};

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
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  void indexedDB.databases().then((databases) => {
    for (const entry of databases) {
      if (entry.name?.startsWith('bandstand:')) indexedDB.deleteDatabase(entry.name);
    }
  });
}
