// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useActiveBandStore } from '../stores/activeBand';

/**
 * Shown instead of any band-scoped page's content once useBandDoc's status
 * is 'forbidden' — see docs/adr/0006-offline-cache-scoping.md. Every page
 * that calls useBandDoc must check for this status before rendering
 * anything derived from the doc, not just Dashboard.
 *
 * The escape hatch has to actually work: a plain link to /dashboard used to
 * sit here, but every band-scoped page (this one included) already lives
 * under /bands/:bandId/..., and when the forbidden band *is* the one on
 * /bands/:bandId/dashboard, that link pointed at the page already on
 * screen — a no-op navigation React Router doesn't remount for, so the
 * stale forbidden status just sat there. Clearing the remembered band
 * before navigating means /dashboard (DashboardRedirect.tsx) always
 * re-resolves from scratch instead of potentially bouncing right back.
 */
export function BandAccessDenied() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);

  function handleGoToDashboard() {
    setActiveBandId(null);
    navigate('/dashboard');
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <p className="text-sm text-muted-foreground">{t('bandAccess.denied')}</p>
      <button type="button" onClick={handleGoToDashboard} className="text-sm underline">
        {t('dashboard.title')}
      </button>
    </main>
  );
}
