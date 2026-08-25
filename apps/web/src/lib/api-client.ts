// SPDX-License-Identifier: Apache-2.0
import { createApiClient } from '@bandstand/api-client';
import { authClient, getDefaultServerUrl } from './auth-client';

// A 401 from any REST call means the local session is no longer valid —
// clear it centrally here rather than each call site handling it. Every
// protected page is wrapped in <RequireAuth>, which reactively redirects to
// /login once the session store reflects the sign-out, so no navigate()
// call is needed here.
export const apiClient = createApiClient(getDefaultServerUrl(), {
  onUnauthorized: () => {
    void authClient.signOut();
  },
});
