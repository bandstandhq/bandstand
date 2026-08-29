// SPDX-License-Identifier: Apache-2.0
//
// The bare /dashboard route. Resolves which band's dashboard to show and
// redirects there — never renders band-scoped content itself (Dashboard,
// at /bands/:bandId/dashboard, does that; see routes/bandRoutes.ts). The
// resolution is re-derived fresh from the *current* session's own bands on
// every visit, rather than trusting activeBandId (persisted client state)
// blindly — that's exactly what let a previous user's last-viewed band
// leak into a brand-new session: sign out, someone else signs in, and
// nothing had ever re-checked whether that id still meant anything for
// them.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { PushNotificationsPanel } from '../components/PushNotificationsPanel';
import { apiClient } from '../lib/api-client';
import { useActiveBandStore } from '../stores/activeBand';
import { CalendarSubscribePanel } from './Dashboard';

export function DashboardRedirect() {
  const { t } = useTranslation();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const [resolvedBandId, setResolvedBandId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiClient.listMyBands().then((bands) => {
      if (cancelled) return;
      const validIds = new Set(bands.map((b) => b.id));
      const target = activeBandId && validIds.has(activeBandId) ? activeBandId : (bands[0]?.id ?? null);
      if (target !== activeBandId) setActiveBandId(target);
      setResolvedBandId(target);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately only on mount, same reasoning as BandSwitcher's own
    // fetch — this always re-runs on a fresh mount anyway, since it's only
    // ever reached via a real navigation to /dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolvedBandId === undefined) return null;
  if (resolvedBandId !== null) return <Navigate to={`/bands/${resolvedBandId}/dashboard`} replace />;

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <AppHeader title={t('dashboard.title')} />
      <p className="mt-4 text-sm text-muted-foreground">{t('dashboard.noBandSelected')}</p>
      <CalendarSubscribePanel />
      <PushNotificationsPanel />
    </main>
  );
}
