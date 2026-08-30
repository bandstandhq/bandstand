// SPDX-License-Identifier: Apache-2.0
//
// Catches exactly the drift the brief warns about: a new English string
// added without its German counterpart (or vice versa) would otherwise
// only surface as a silent fallback-to-English in the UI, easy to miss for
// weeks.
import { describe, expect, it } from 'vitest';
import de from './locales/de.json';
import en from './locales/en.json';

function collectKeyPaths(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locale files', () => {
  it('en.json and de.json define exactly the same set of keys', () => {
    const enKeys = new Set(collectKeyPaths(en));
    const deKeys = new Set(collectKeyPaths(de));

    const missingFromDe = [...enKeys].filter((k) => !deKeys.has(k)).sort();
    const missingFromEn = [...deKeys].filter((k) => !enKeys.has(k)).sort();

    expect(missingFromDe, 'keys present in en.json but missing from de.json').toEqual([]);
    expect(missingFromEn, 'keys present in de.json but missing from en.json').toEqual([]);
  });

  it('every interpolation placeholder in en.json also appears in de.json\'s value for the same key', () => {
    function collectPlaceholders(value: string): Set<string> {
      return new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));
    }

    function flatten(node: unknown, prefix = ''): Record<string, string> {
      if (typeof node === 'string') return { [prefix]: node };
      return Object.entries(node as Record<string, unknown>).reduce(
        (acc, [key, value]) => ({ ...acc, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
        {},
      );
    }

    const enFlat = flatten(en);
    const deFlat = flatten(de);
    const mismatches: string[] = [];

    for (const [key, enValue] of Object.entries(enFlat)) {
      const deValue = deFlat[key];
      if (deValue === undefined) continue; // already reported by the key-parity test above
      const enPlaceholders = collectPlaceholders(enValue);
      const dePlaceholders = collectPlaceholders(deValue);
      const missing = [...enPlaceholders].filter((p) => !dePlaceholders.has(p));
      if (missing.length > 0) mismatches.push(`${key}: missing {{${missing.join('}}, {{')}}}`);
    }

    expect(mismatches).toEqual([]);
  });
});
