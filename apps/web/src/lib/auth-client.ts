// SPDX-License-Identifier: Apache-2.0
//
// Browser context uses better-auth's cookie session by default. A
// wrapped context (Capacitor/Tauri) can't rely on that cookie — it's
// SameSite=Lax with no Secure flag, and the app's own origin
// (https://localhost for Capacitor Android) is genuinely cross-origin from
// the real server, so the browser/WebView never stores or sends it. See
// docs/adr/0001-monorepo-thin-wrapper.md: those contexts use the
// jwt()/bearer() plugins instead (already enabled server-side, see
// apps/server/src/lib/auth.ts) — the server already returns a
// `set-auth-token` response header on every successful sign-in, exposed
// cross-origin via CORS. fetchOptions below captures that header into
// authToken.ts's storage and re-attaches it as `Authorization: Bearer` on
// every subsequent request, entirely in place of the cookie for a wrapped
// app. Both hooks are gated on isWrappedApp() so a plain browser session's
// behavior — cookie-only, no token ever persisted — is unchanged.
import { createAuthClient } from 'better-auth/react';
import { clearToken, getStoredToken, persistToken } from './authToken';
import { clearCachedSession } from './sessionCache';
import { getActiveServerConfig, isWrappedApp } from './serverConfig';

// Extracted as named functions (rather than inlined in the fetchOptions
// object below) purely so they're directly unit-testable without going
// through createAuthClient's real construction.
export function handleAuthFetchSuccess(context: { response: Response }): void {
  if (!isWrappedApp()) return;
  const token = context.response.headers.get('set-auth-token');
  if (token) persistToken(token);
}

export function resolveAuthToken(): string | undefined {
  return isWrappedApp() ? getStoredToken() : undefined;
}

export const authClient = createAuthClient({
  baseURL: getActiveServerConfig().serverUrl,
  fetchOptions: {
    onSuccess: handleAuthFetchSuccess,
    auth: {
      type: 'Bearer',
      token: resolveAuthToken,
    },
  },
});

// Centralizes clearing the stored bearer token and cached session (see
// sessionCache.ts — a stale one left behind would let RequireAuth treat a
// signed-out device as still-authenticated-but-offline the next time it
// can't reach the server) on sign-out — a stale token must not outlive the
// session better-auth itself considers ended. Call sites (AppHeader.tsx,
// api-client.ts's onUnauthorized) use this instead of authClient.signOut()
// directly. clearToken() is a no-op past the base call for a plain browser
// session, which never had a token stored.
export async function signOut(): Promise<void> {
  await authClient.signOut();
  clearToken();
  clearCachedSession();
}
