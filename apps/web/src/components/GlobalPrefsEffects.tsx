// SPDX-License-Identifier: Apache-2.0
//
// Mounted once, outside <Routes> (see router.tsx), so it keeps running
// across every navigation instead of being torn down and rebuilt on each
// page: applies three of the signed-in user's prefs app-wide — the
// light/dark theme (a `.dark` class on the document root, shadcn/ui's usual
// convention — see packages/ui/src/styles.css's own header comment; Stage
// Mode's own chrome reads the same `prefs.theme` value directly rather than
// this class, but writes through the same store, so the two can no longer
// drift out of sync — see issue #110), the "keep screen awake" toggle
// (Stage Mode's own always-on wake lock, StageMode.tsx, is separate and
// unaffected by this), and the active UI language, including detecting it
// from the browser on first-ever visit and persisting that choice back to
// user_prefs rather than leaving it only local (see AccountSettings.tsx and
// docs referenced there).
//
// `theme: 'system'` (the default) is resolved live via useMediaQuery —
// unlike locale's `null`, it's never auto-converted into a concrete stored
// choice, so this re-evaluates (and the `.dark` class flips) whenever the
// OS preference itself changes while the app is open, for as long as
// 'system' stays selected.
import { useEffect, useRef } from 'react';
import i18n from '../i18n';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { detectLocale } from '../lib/detectLocale';
import { resolveTheme } from '../lib/resolveTheme';
import { useTrustedSession } from '../hooks/useTrustedSession';
import { useWakeLock } from '../hooks/useWakeLock';
import { useUserPrefsStore } from '../stores/userPrefs';

export function GlobalPrefsEffects(): null {
  // useTrustedSession, not the raw hook — otherwise a real logged-in user
  // who goes offline sees `session: null` here same as a genuine sign-out,
  // and the effect below resets every pref (theme, locale, wake-lock) back
  // to its default right in the middle of a session, rather than just
  // keeping whatever was already loaded.
  const { data: session } = useTrustedSession();
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

  const systemPrefersLight = useMediaQuery('(prefers-color-scheme: light)');
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle('dark', resolveTheme(prefs.theme, systemPrefersLight) === 'dark');
  }, [loaded, prefs.theme, systemPrefersLight]);

  useWakeLock(loaded && Boolean(userId) && prefs.keepScreenAwake);

  return null;
}
