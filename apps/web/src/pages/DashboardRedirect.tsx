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
import type { Band } from '@bandstand/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { CreateBandForm } from '../components/CreateBandForm';
import { JoinBandForm } from '../components/JoinBandForm';
import { PageShell } from '../components/PageShell';
import { apiClient } from '../lib/api-client';
import { useActiveBandStore } from '../stores/activeBand';

export function DashboardRedirect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const [resolvedBandId, setResolvedBandId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listMyBands()
      .then((bands) => {
        if (cancelled) return;
        const validIds = new Set(bands.map((b) => b.id));
        const target = activeBandId && validIds.has(activeBandId) ? activeBandId : (bands[0]?.id ?? null);
        if (target !== activeBandId) setActiveBandId(target);
        setResolvedBandId(target);
      })
      .catch(() => {
        // Offline/unreachable — without this, resolvedBandId stays
        // `undefined` forever and this component renders null forever (a
        // real reported bug: opening the app straight to /dashboard while
        // offline showed nothing at all). Trust whichever band this device
        // was last showing rather than getting stuck blank; a genuinely
        // stale or now-invalid id gets caught the normal way once real data
        // loads (BandAccessDenied, the membership checks elsewhere).
        if (cancelled) return;
        setResolvedBandId(activeBandId ?? null);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately only on mount, same reasoning as BandSwitcher's own
    // fetch — this always re-runs on a fresh mount anyway, since it's only
    // ever reached via a real navigation to /dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToBand(band: Band) {
    setActiveBandId(band.id);
    navigate(`/bands/${band.id}/dashboard`);
  }

  if (resolvedBandId === undefined) return null;
  if (resolvedBandId !== null) return <Navigate to={`/bands/${resolvedBandId}/dashboard`} replace />;

  // A brand-new account's very first screen — worth a real first
  // impression rather than the join/create panel that fits an already-busy
  // menu elsewhere. The invite-code field is rendered straight away, not
  // behind a second toggle: this is the one moment a bandless user
  // actually needs it front and center.
  return (
    <PageShell title={t('dashboard.title')}>
      <div className="mx-auto mt-10 max-w-md text-center">
        <h2 className="text-lg font-medium">{t('dashboard.welcomeTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.welcomeDescription')}</p>

        <div className="mt-6 rounded-md border border-border p-4 text-left">
          <h3 className="text-sm font-medium">{t('joinBand.title')}</h3>
          <div className="mt-3">
            <JoinBandForm onJoined={goToBand} />
          </div>
        </div>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" aria-hidden="true" />
          {t('dashboard.welcomeOr')}
          <div className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>

        <div className="rounded-md border border-border p-4 text-left">
          <h3 className="text-sm font-medium">{t('bandSwitcher.createBandToggle')}</h3>
          <div className="mt-3">
            <CreateBandForm onCreated={goToBand} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
