// SPDX-License-Identifier: Apache-2.0
//
// Every UI string goes through i18next from day one — retrofitting it
// later is expensive in React (every hardcoded string would need to be
// found and replaced). LanguageDetector only supplies i18next's very
// first paint, before user_prefs has loaded — GlobalPrefsEffects.tsx
// overrides it with the user's actual stored (or, on a first-ever visit,
// freshly detected-and-persisted) choice as soon as that request resolves,
// so this is never the lasting source of truth for which language is
// active.
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import en from './locales/en.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, de: { translation: de } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'de'],
    interpolation: { escapeValue: false },
  });

export default i18n;
