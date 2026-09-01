// SPDX-License-Identifier: Apache-2.0
//
// Personal, cross-band settings — everything here lives in user_prefs, so
// it follows the user to any device, unlike a band's own settings
// (BandSettings.tsx). Reachable from AppHeader's menu on every page.
import type { ArchivedBand, MyBand } from '@bandstand/api-client';
import type { Band, Locale } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangeNameForm } from '../components/ChangeNameForm';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { CreateBandForm } from '../components/CreateBandForm';
import { JoinBandForm } from '../components/JoinBandForm';
import { PageShell } from '../components/PageShell';
import { isWakeLockSupported } from '../hooks/useWakeLock';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import { deleteAllLocalBandData } from '../lib/yjs';
import { useActiveBandStore } from '../stores/activeBand';
import { useThemeStore } from '../stores/theme';
import { useUserPrefsStore } from '../stores/userPrefs';

const LOCALES: Locale[] = ['en', 'de'];

export function AccountSettings() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const prefs = useUserPrefsStore((s) => s.prefs);
  const loaded = useUserPrefsStore((s) => s.loaded);
  const load = useUserPrefsStore((s) => s.load);
  const update = useUserPrefsStore((s) => s.update);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const [bands, setBands] = useState<MyBand[] | null>(null);
  const [archivedBands, setArchivedBands] = useState<ArchivedBand[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    apiClient.listMyBands().then(setBands);
    apiClient.listArchivedBands().then(setArchivedBands);
  }, []);

  async function handleRestore(bandId: string) {
    setRestoringId(bandId);
    try {
      await apiClient.restoreBand(bandId);
      setArchivedBands((prev) => prev?.filter((b) => b.id !== bandId) ?? null);
      apiClient.listMyBands().then(setBands);
    } finally {
      setRestoringId(null);
    }
  }

  function handleJoined(band: Band) {
    setBands((prev) => [...(prev ?? []), { ...band, role: 'member' }]);
    setActiveBandId(band.id);
  }

  function handleCreated(band: Band) {
    setBands((prev) => [...(prev ?? []), { ...band, role: 'owner' }]);
    setActiveBandId(band.id);
  }

  async function handleDeleteLocalData() {
    if (!session) return;
    if (!window.confirm(t('appHeader.deleteLocalDataConfirm'))) return;
    await deleteAllLocalBandData(session.user.id);
    window.alert(t('appHeader.deleteLocalDataDone'));
  }

  const wakeLockSupported = isWakeLockSupported();

  return (
    <PageShell title={t('accountSettings.title')}>
      <div className="mx-auto max-w-lg">
        {session && (
          <div className="mt-4 rounded-md border border-border p-4">
            <h2 className="font-medium">{t('accountSettings.profileTitle')}</h2>
            <div className="mt-3">
              <ChangeNameForm currentName={session.user.name} />
            </div>
          </div>
        )}

        {session && (
          <div className="mt-4 rounded-md border border-border p-4">
            <h2 className="font-medium">{t('accountSettings.passwordTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.passwordDescription')}</p>
            <div className="mt-3">
              <ChangePasswordForm />
            </div>
          </div>
        )}

        {/* Only once there's at least one band to switch away from —
            joining/creating your very first band has its own, more
            prominent spot on the empty /dashboard instead (see
            DashboardRedirect.tsx). */}
        {bands !== null && bands.length > 0 && (
          <div className="mt-4 rounded-md border border-border p-4">
            <h2 className="font-medium">{t('accountSettings.bandsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.bandsDescription')}</p>
            <div className="mt-3 space-y-3">
              <JoinBandForm onJoined={handleJoined} />
              <CreateBandForm onCreated={handleCreated} />
            </div>
          </div>
        )}

        {archivedBands !== null && archivedBands.length > 0 && (
          <div className="mt-4 rounded-md border border-border p-4">
            <h2 className="font-medium">{t('accountSettings.archivedTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.archivedDescription')}</p>
            <ul className="mt-3 space-y-3">
              {archivedBands.map((band) => (
                <li key={band.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                  <div>
                    <p className="font-medium">{band.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('accountSettings.archivedPermanentDeletionAt', {
                        date: new Date(band.permanentDeletionAt).toLocaleDateString(),
                      })}
                    </p>
                  </div>
                  <Button size="sm" disabled={restoringId === band.id} onClick={() => void handleRestore(band.id)}>
                    {restoringId === band.id ? t('accountSettings.archivedRestoring') : t('accountSettings.archivedRestore')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 rounded-md border border-border p-4">
          <h2 className="font-medium">{t('accountSettings.languageTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.languageDescription')}</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('accountSettings.languageLabel')}</span>
            <select
              value={prefs.locale ?? ''}
              onChange={(e) => void update({ locale: e.target.value as Locale })}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            >
              {!prefs.locale && (
                <option value="" disabled>
                  {t('accountSettings.languageDetecting')}
                </option>
              )}
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {t(`accountSettings.language_${locale}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-md border border-border p-4">
          <h2 className="font-medium">{t('accountSettings.wakeLockTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.wakeLockDescription')}</p>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.keepScreenAwake}
              disabled={!wakeLockSupported}
              onChange={() => void update({ keepScreenAwake: !prefs.keepScreenAwake })}
            />
            {t('accountSettings.wakeLockLabel')}
          </label>
          {!wakeLockSupported && (
            <p className="mt-2 text-xs text-muted-foreground">{t('accountSettings.wakeLockUnsupported')}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t('accountSettings.wakeLockStageModeNote')}</p>
        </div>

        <div className="mt-4 rounded-md border border-border p-4">
          <h2 className="font-medium">{t('accountSettings.themeTitle')}</h2>
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="mt-3"
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? t('appHeader.themeLight') : t('appHeader.themeDark')}
          </Button>
        </div>

        <div className="mt-4 rounded-md border border-border p-4">
          <h2 className="font-medium">{t('accountSettings.localDataTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('accountSettings.localDataDescription')}</p>
          <Button variant="destructive" size="sm" className="mt-3" onClick={() => void handleDeleteLocalData()}>
            {t('appHeader.deleteLocalData')}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
