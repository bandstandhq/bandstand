// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { detectLocale } from './detectLocale';

describe('detectLocale', () => {
  it('picks a supported language directly', () => {
    expect(detectLocale(['de'])).toBe('de');
    expect(detectLocale(['en'])).toBe('en');
  });

  it('matches a regional variant by its base language', () => {
    expect(detectLocale(['de-CH'])).toBe('de');
    expect(detectLocale(['de-AT'])).toBe('de');
  });

  it('takes the first supported match in preference order', () => {
    expect(detectLocale(['fr-FR', 'de-DE', 'en-US'])).toBe('de');
  });

  it('falls back to English when nothing matches', () => {
    expect(detectLocale(['fr-FR', 'es-ES'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
