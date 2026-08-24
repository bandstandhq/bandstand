// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  isMinorKeyName,
  isStandardKey,
  normalizeKey,
  parseKeyName,
  shiftKeyBySemitones,
  STANDARD_KEYS,
} from './keys';

const MAJOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'major').map((k) => k.name);
const MINOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'minor').map((k) => k.name);

describe('STANDARD_KEYS', () => {
  it('has exactly 15 major and 15 minor keys', () => {
    expect(MAJOR_KEYS).toHaveLength(15);
    expect(MINOR_KEYS).toHaveLength(15);
  });

  it('covers all 12 semitones in each mode, with exactly one standard key per semitone', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (let semitone = 0; semitone < 12; semitone++) {
        const standardMatches = STANDARD_KEYS.filter((k) => k.mode === mode && k.semitone === semitone && k.standard);
        expect(standardMatches).toHaveLength(1);
      }
    }
  });

  it('never includes the enharmonically-exotic spellings this fix rules out', () => {
    for (const key of [...MAJOR_KEYS, ...MINOR_KEYS]) {
      expect(key).not.toMatch(/^(B#|E#|Fb)m?$/);
    }
  });
});

describe('isStandardKey', () => {
  it.each([...MAJOR_KEYS, ...MINOR_KEYS])('accepts %s', (key) => {
    expect(isStandardKey(key)).toBe(true);
  });

  it.each(['B#', 'E#', 'Fb', 'D#', 'G#', 'A#', 'B#m', 'E#m', 'Fbm'])('rejects %s', (key) => {
    expect(isStandardKey(key)).toBe(false);
  });
});

describe('normalizeKey', () => {
  it('leaves an already-standard key unchanged, including alternates', () => {
    for (const key of [...MAJOR_KEYS, ...MINOR_KEYS]) {
      expect(normalizeKey(key)).toBe(key);
    }
  });

  it.each([
    ['B#', 'C'],
    ['E#', 'F'],
    ['Fb', 'E'],
    ['D#', 'Eb'],
    ['G#', 'Ab'],
    ['A#', 'Bb'],
    ['B#m', 'Cm'],
    ['E#m', 'Fm'],
  ])('normalizes the enharmonically-usual invalid spelling %s to %s', (invalid, expected) => {
    expect(normalizeKey(invalid)).toBe(expected);
  });
});

describe('shiftKeyBySemitones', () => {
  // shiftKeyBySemitones always names its result by the *standard* spelling
  // for the resulting pitch (that's what makes it a pure function of a
  // semitone offset, with nothing to remember between clicks) — so a full
  // circle only returns the exact original string for keys that were
  // already standard. Starting from an alternate (Db, Gb, Cb, ...) still
  // returns to the same pitch, just spelled as that pitch's standard name.
  const STANDARD_MAJOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'major' && k.standard).map((k) => k.name);
  const STANDARD_MINOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'minor' && k.standard).map((k) => k.name);
  const ALTERNATE_KEYS = STANDARD_KEYS.filter((k) => !k.standard);

  it.each(STANDARD_MAJOR_KEYS)('shifting the standard key %s by 12 semitones returns the exact same spelling', (key) => {
    expect(shiftKeyBySemitones(key, 12)).toBe(key);
  });

  it.each(STANDARD_MINOR_KEYS)('shifting the standard key %s by 12 semitones returns the exact same spelling', (key) => {
    expect(shiftKeyBySemitones(key, 12)).toBe(key);
  });

  it.each(STANDARD_MAJOR_KEYS)('shifting the standard key %s by -12 semitones returns the exact same spelling', (key) => {
    expect(shiftKeyBySemitones(key, -12)).toBe(key);
  });

  it.each(ALTERNATE_KEYS.map((k) => k.name))(
    'shifting the alternate key %s by 12 semitones returns to the same pitch, as its standard spelling',
    (key) => {
      const info = parseKeyName(key)!;
      const standardName = STANDARD_KEYS.find((k) => k.mode === info.mode && k.semitone === info.semitone && k.standard)!.name;
      expect(shiftKeyBySemitones(key, 12)).toBe(standardName);
    },
  );

  it('reaches G from G via +5 then +7 (a full circle, not just a single step)', () => {
    expect(shiftKeyBySemitones(shiftKeyBySemitones('G', 5), 7)).toBe('G');
  });

  it('stays within the standard 15 for every semitone offset from every major key', () => {
    for (const key of MAJOR_KEYS) {
      for (let delta = -24; delta <= 24; delta++) {
        expect(isStandardKey(shiftKeyBySemitones(key, delta))).toBe(true);
      }
    }
  });

  it('never produces the mode of the other (major stays major, minor stays minor)', () => {
    for (const key of MAJOR_KEYS) expect(isMinorKeyName(shiftKeyBySemitones(key, 3))).toBe(false);
    for (const key of MINOR_KEYS) expect(isMinorKeyName(shiftKeyBySemitones(key, 3))).toBe(true);
  });
});

describe('parseKeyName', () => {
  it('reports the correct semitone and accidental for the two enharmonic pairs', () => {
    expect(parseKeyName('F#')).toMatchObject({ semitone: 6, accidental: '#', standard: true });
    expect(parseKeyName('Gb')).toMatchObject({ semitone: 6, accidental: 'b', standard: false });
    expect(parseKeyName('C#')).toMatchObject({ semitone: 1, accidental: '#', standard: true });
    expect(parseKeyName('Db')).toMatchObject({ semitone: 1, accidental: 'b', standard: false });
  });
});
