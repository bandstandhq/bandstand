// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { authClient } from '../lib/auth-client';

/**
 * Three states, not two. `isPending` (the session store hasn't resolved
 * yet) is deliberately distinct from "confirmed anonymous" — a guard that
 * only knows "logged in" vs "not logged in" treats a still-loading session
 * as "not logged in" and redirects prematurely. Every protected route in
 * router.tsx wraps its element in this, replacing the one-off inline check
 * that used to live only in Dashboard.tsx.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();

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
