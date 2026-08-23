// SPDX-License-Identifier: Apache-2.0
//
// English is the only shipped locale for now, but every UI string goes
// through i18next from day one — retrofitting it later is expensive in
// React (every hardcoded string would need to be found and replaced).
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: 'en',
    supportedLngs: ['en'],
    interpolation: { escapeValue: false },
  });

export default i18n;
