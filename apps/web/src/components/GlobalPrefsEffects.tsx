// SPDX-License-Identifier: Apache-2.0
//
// Mounted once, outside <Routes> (see router.tsx), so it keeps running
// across every navigation instead of being torn down and rebuilt on each
// page: applies two of the signed-in user's prefs app-wide — the "keep
// screen awake" toggle (Stage Mode's own always-on wake lock, StageMode.tsx,
// is separate and unaffected by this) and the active UI language, including
// detecting it from the browser on first-ever visit and persisting that
// choice back to user_prefs rather than leaving it only local (see
// AccountSettings.tsx and docs referenced there).
import { useEffect, useRef } from 'react';
import i18n from '../i18n';
import { detectLocale } from '../lib/detectLocale';
import { authClient } from '../lib/auth-client';
import { useWakeLock } from '../hooks/useWakeLock';
import { useUserPrefsStore } from '../stores/userPrefs';

export function GlobalPrefsEffects(): null {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;

  const prefs = useUserPrefsStore((s) => s.prefs);
  const loaded = useUserPrefsStore((s) => s.loaded);
  const load = useUserPrefsStore((s) => s.load);
  const update = useUserPrefsStore((s) => s.update);
  const reset = useUserPrefsStore((s) => s.reset);

  const loadedForUserRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!userId) {
      if (loadedForUserRef.current !== undefined) reset();
      loadedForUserRef.current = undefined;
      return;
    }
    if (loadedForUserRef.current === userId) return;
    loadedForUserRef.current = userId;
    void load();
  }, [userId, load, reset]);

  useEffect(() => {
    if (!loaded) return;
    if (prefs.locale) {
      void i18n.changeLanguage(prefs.locale);
      return;
    }
    // Never explicitly chosen — detect once and persist it as the real
    // choice (not just this session's local i18next state), so it's
    // already right the next time this user opens Bandstand anywhere.
    const detected = detectLocale(navigator.languages ?? [navigator.language]);
    void i18n.changeLanguage(detected);
    void update({ locale: detected });
  }, [loaded, prefs.locale, update]);

  useWakeLock(loaded && Boolean(userId) && prefs.keepScreenAwake);

  return null;
}
