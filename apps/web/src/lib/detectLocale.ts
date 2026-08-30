// SPDX-License-Identifier: Apache-2.0
import type { Locale } from '@bandstand/core';

const SUPPORTED: readonly Locale[] = ['en', 'de'];

/**
 * Picks the first of the browser's preferred languages (most-preferred
 * first, as `navigator.languages` already orders them) that Bandstand
 * ships a translation for, matching by base language tag (`de-CH` ->
 * `de`) since we don't ship per-region variants. Falls back to English —
 * the only locale guaranteed to exist — when none match.
 */
export function detectLocale(preferredLanguages: readonly string[]): Locale {
  for (const lang of preferredLanguages) {
    const base = lang.split('-')[0]?.toLowerCase();
    const match = SUPPORTED.find((locale) => locale === base);
    if (match) return match;
  }
  return 'en';
}
