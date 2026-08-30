// SPDX-License-Identifier: Apache-2.0
//
// Personal, cross-band settings — everything here lives in user_prefs, so
// it follows the user to any device, unlike a band's own settings
// (BandSettings.tsx). Reachable from AppHeader's menu on every page.
import type { Locale } from '@bandstand/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { isWakeLockSupported } from '../hooks/useWakeLock';
import { useUserPrefsStore } from '../stores/userPrefs';

const LOCALES: Locale[] = ['en', 'de'];

export function AccountSettings() {
  const { t } = useTranslation();
  const prefs = useUserPrefsStore((s) => s.prefs);
  const loaded = useUserPrefsStore((s) => s.loaded);
  const load = useUserPrefsStore((s) => s.load);
  const update = useUserPrefsStore((s) => s.update);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const wakeLockSupported = isWakeLockSupported();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader title={t('accountSettings.title')} />
      <main className="mx-auto max-w-lg p-4 sm:p-6">
        <div className="rounded-md border border-border p-4">
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
      </main>
    </div>
  );
}
