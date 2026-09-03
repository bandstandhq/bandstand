// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { useTrustedSession } from '../hooks/useTrustedSession';
import { setCachedSession } from '../lib/sessionCache';

/**
 * Four states, not two. `isPending` (the session store hasn't resolved
 * yet) is deliberately distinct from "confirmed anonymous" — a guard that
 * only knows "logged in" vs "not logged in" treats a still-loading session
 * as "not logged in" and redirects prematurely. Every protected route in
 * router.tsx wraps its element in this, replacing the one-off inline check
 * that used to live only in Dashboard.tsx.
 *
 * The fourth state: `error` present (the session check itself couldn't
 * complete — offline, unreachable server, a 5xx) with a previously
 * confirmed session cached locally (sessionCache.ts, via useTrustedSession).
 * better-auth's own session store lives only in memory, so it's gone after
 * a full reload — without this, reloading the app while offline looks
 * identical to a real logged-out response and bounces a legitimately-signed-
 * in user to /login, defeating the rest of this app's IndexedDB-backed
 * offline story. This is a UX gate, not the security boundary (every real
 * mutation is independently checked server-side, see apiClient's own
 * onUnauthorized), so trusting a stale cached session a little too long
 * here costs nothing a genuinely-revoked session wouldn't already get
 * caught by on its own next real request.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: session, freshData, isPending } = useTrustedSession();
  const location = useLocation();

  useEffect(() => {
    if (freshData) setCachedSession(freshData);
  }, [freshData]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {t('common.loading')}
      </main>
    );
  }

  if (!session) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}
