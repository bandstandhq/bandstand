// SPDX-License-Identifier: Apache-2.0
//
// Browser context uses better-auth's cookie session by default. A
// native-wrapped context (Capacitor/Tauri) needs the bearer token instead,
// since cross-origin cookies are unreliable in capacitor:///tauri://
// WebViews — see docs/adr/0001-monorepo-thin-wrapper.md. That branch has
// nothing to detect yet (apps/mobile and apps/desktop are config-only in
// this milestone) so it isn't implemented here; it belongs in this one
// shared client, not in the wrapper apps, once they load real builds.
import { createAuthClient } from 'better-auth/react';
import { withRuntimeHost } from './networkHost';

export const authClient = createAuthClient({
  baseURL: getDefaultServerUrl(),
});

// The sync server URL is configurable per account/device (see
// docs/ARCHITECTURE.md) — this is only the build-time default. Its host is
// swapped at runtime when it's a loopback address (see networkHost.ts) so
// the app keeps working when opened from another device on the LAN.
export function getDefaultServerUrl(): string {
  return withRuntimeHost(import.meta.env.VITE_DEFAULT_SERVER_URL ?? 'http://localhost:3001');
}
