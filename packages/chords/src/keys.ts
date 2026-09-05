// SPDX-License-Identifier: Apache-2.0
//
// The circle of fifths' 15 conventional major keys (≤7 sharps or ≤7 flats)
// and their relative minors — the only keys this app treats as valid
// transpose targets. Major has 3 enharmonic pairs (C#/Db, F#/Gb, B/Cb);
// minor independently has its own 3 commonly-used pairs (D#m/Ebm, A#m/Bbm,
// G#m/Abm) that don't line up with major's at all, *plus* C#m/Dbm, F#m/Gbm,
// and Bm/Cbm purely so every major-key letter+accidental the song editor's
// Key dropdown offers (KEY_LETTER_OPTIONS) has a matching minor spelling —
// without these three, toggling Major/Minor mode on a song whose key is
// Db, Gb, or Cb constructed a key name ("Dbm" etc.) this table didn't
// recognize, and transposeChordProToKey threw (issue #265). Every pair
// keeps one entry marked `standard` for when a single default is needed
// (the semitone nudge buttons, normalizing legacy data). Anything else a
// naive semitone-based transpose can produce — B#, E#, Fb, and their like
// — is deliberately unrepresentable here: that's the bug this table exists
// to close (see transpose.ts's transposeChordProToKey).
export type KeyMode = 'major' | 'minor';

export interface KeyInfo {
  name: string;
  mode: KeyMode;
  /** 0 = C/Cm, 1 = C#/Db, ... 11 = B/Cb — this key's own tonic pitch. */
  semitone: number;
  accidental: '#' | 'b';
  /** false only for the "alternate" spelling of an enharmonic pair. */
  standard: boolean;
}

export const STANDARD_KEYS: readonly KeyInfo[] = [
  { name: 'C', mode: 'major', semitone: 0, accidental: '#', standard: true },
  { name: 'Db', mode: 'major', semitone: 1, accidental: 'b', standard: false },
  { name: 'C#', mode: 'major', semitone: 1, accidental: '#', standard: true },
  { name: 'D', mode: 'major', semitone: 2, accidental: '#', standard: true },
  { name: 'Eb', mode: 'major', semitone: 3, accidental: 'b', standard: true },
  { name: 'E', mode: 'major', semitone: 4, accidental: '#', standard: true },
  { name: 'F', mode: 'major', semitone: 5, accidental: 'b', standard: true },
  { name: 'Gb', mode: 'major', semitone: 6, accidental: 'b', standard: false },
  { name: 'F#', mode: 'major', semitone: 6, accidental: '#', standard: true },
  { name: 'G', mode: 'major', semitone: 7, accidental: '#', standard: true },
  { name: 'Ab', mode: 'major', semitone: 8, accidental: 'b', standard: true },
  { name: 'A', mode: 'major', semitone: 9, accidental: '#', standard: true },
  { name: 'Bb', mode: 'major', semitone: 10, accidental: 'b', standard: true },
  { name: 'B', mode: 'major', semitone: 11, accidental: '#', standard: true },
  { name: 'Cb', mode: 'major', semitone: 11, accidental: 'b', standard: false },

  { name: 'Am', mode: 'minor', semitone: 9, accidental: '#', standard: true },
  { name: 'Bbm', mode: 'minor', semitone: 10, accidental: 'b', standard: false },
  { name: 'A#m', mode: 'minor', semitone: 10, accidental: '#', standard: true },
  { name: 'Bm', mode: 'minor', semitone: 11, accidental: '#', standard: true },
  { name: 'Cbm', mode: 'minor', semitone: 11, accidental: 'b', standard: false },
  { name: 'Cm', mode: 'minor', semitone: 0, accidental: 'b', standard: true },
  { name: 'Dbm', mode: 'minor', semitone: 1, accidental: 'b', standard: false },
  { name: 'C#m', mode: 'minor', semitone: 1, accidental: '#', standard: true },
  { name: 'Dm', mode: 'minor', semitone: 2, accidental: 'b', standard: true },
  { name: 'Ebm', mode: 'minor', semitone: 3, accidental: 'b', standard: false },
  { name: 'D#m', mode: 'minor', semitone: 3, accidental: '#', standard: true },
  { name: 'Em', mode: 'minor', semitone: 4, accidental: '#', standard: true },
  { name: 'Fm', mode: 'minor', semitone: 5, accidental: 'b', standard: true },
  { name: 'Gbm', mode: 'minor', semitone: 6, accidental: 'b', standard: false },
  { name: 'F#m', mode: 'minor', semitone: 6, accidental: '#', standard: true },
  { name: 'Gm', mode: 'minor', semitone: 7, accidental: 'b', standard: true },
  { name: 'G#m', mode: 'minor', semitone: 8, accidental: '#', standard: true },
  { name: 'Abm', mode: 'minor', semitone: 8, accidental: 'b', standard: false },
];

const BASE_LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const RAW_KEY_PATTERN = /^([A-G])(#|b)?(m)?$/;

/**
 * The tonic pitch class of *any* letter+accidental spelling this app's
 * `musicalKeySchema` regex allows — including ones outside the standard
 * 15, like "B#" or "Fb". Used to recover a semitone for legacy-invalid
 * stored keys so they can be normalized (see normalizeKey below).
 */
function rawKeySemitone(key: string): number {
  const match = RAW_KEY_PATTERN.exec(key);
  if (!match) throw new Error(`"${key}" is not a musical key`);
  const [, letter, accidental] = match;
  let semitone = BASE_LETTER_SEMITONE[letter!]!;
  if (accidental === '#') semitone += 1;
  if (accidental === 'b') semitone -= 1;
  return ((semitone % 12) + 12) % 12;
}

export function isMinorKeyName(key: string): boolean {
  return key.endsWith('m');
}

/** Looks up an exact standard-key name (e.g. "F#", "Bbm"). Undefined if it's not one of the 15. */
export function parseKeyName(key: string): KeyInfo | undefined {
  return STANDARD_KEYS.find((k) => k.name === key);
}

export function isStandardKey(key: string): boolean {
  return parseKeyName(key) !== undefined;
}

function standardKeyFor(semitone: number, mode: KeyMode): KeyInfo {
  const key = STANDARD_KEYS.find((k) => k.mode === mode && k.semitone === semitone && k.standard);
  if (!key) throw new Error(`No standard ${mode} key for semitone ${semitone}`);
  return key;
}

/**
 * Maps any musical-key-shaped string (including legacy-invalid ones like
 * "B#" or "E#") to its canonical standard-key name — the enharmonically
 * usual spelling for that pitch ("B#" -> "C"). A key already in the
 * standard 15 is returned unchanged, alternates (e.g. "Gb") included.
 */
export function normalizeKey(key: string): string {
  if (isStandardKey(key)) return key;
  const semitone = rawKeySemitone(key);
  const mode: KeyMode = isMinorKeyName(key) ? 'minor' : 'major';
  return standardKeyFor(semitone, mode).name;
}

/**
 * Computes the target key `delta` semitones away from `fromKey`, always
 * landing on a standard key (mod 12) in the same mode as `fromKey`. Used
 * by the semitone nudge buttons: they compute a new *target key* this way,
 * then transpose from the original stored key in a single step — see
 * transposeChordProToKey.
 */
export function shiftKeyBySemitones(fromKey: string, delta: number): string {
  const from = parseKeyName(normalizeKey(fromKey));
  const semitone = ((from!.semitone + delta) % 12 + 12) % 12;
  return standardKeyFor(semitone, from!.mode).name;
}
