// SPDX-License-Identifier: Apache-2.0
import { createApiClient } from '@bandstand/api-client';
import { signOut } from './auth-client';
import { getStoredToken } from './authToken';
import { getActiveServerConfig } from './serverConfig';

// A 401 from any REST call means the local session is no longer valid —
// clear it centrally here rather than each call site handling it. Every
// protected page is wrapped in <RequireAuth>, which reactively redirects to
// /login once the session store reflects the sign-out, so no navigate()
// call is needed here.
export const apiClient = createApiClient(getActiveServerConfig().serverUrl, {
  onUnauthorized: () => {
    void signOut();
  },
  // No isWrappedApp() check needed: getStoredToken() only ever returns a
  // value for a wrapped app (auth-client.ts is the only writer, and it's
  // already gated) — a plain browser session's calls simply never carry
  // the header.
  getAuthToken: getStoredToken,
});
