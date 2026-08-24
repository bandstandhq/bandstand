// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/**
 * Shown instead of any band-scoped page's content once useBandDoc's status
 * is 'forbidden' — see docs/adr/0006-offline-cache-scoping.md. Every page
 * that calls useBandDoc must check for this status before rendering
 * anything derived from the doc, not just Dashboard.
 */
export function BandAccessDenied() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <p className="text-sm text-muted-foreground">{t('bandAccess.denied')}</p>
      <Link to="/dashboard" className="text-sm underline">
        {t('dashboard.title')}
      </Link>
    </main>
  );
}
