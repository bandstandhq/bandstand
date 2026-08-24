// SPDX-License-Identifier: Apache-2.0
import type { Song } from 'chordsheetjs';
import { normalizeKey, parseKeyName } from './keys';

export interface TransposeOptions {
  /**
   * Explicit key to transpose from, overriding any `{key: ...}` directive
   * embedded in the ChordPro source. Also controls sharp/flat spelling for
   * the transposed output (a flat-spelled key keeps flat spelling, a
   * sharp-spelled key keeps sharp spelling — chordsheetjs otherwise leaves
   * this to its own default and won't necessarily match the song's key).
   */
  key?: string;
}

/**
 * Sharp/flat spelling for a key, looked up from the standard 15 keys
 * (packages/chords/src/keys.ts) rather than guessed from the string —
 * a `key.includes('b')` heuristic can never produce a key outside that
 * table (e.g. it'll happily spell C as "B#"). Legacy-invalid keys are
 * normalized first, so this never throws on data written before this fix.
 */
function accidentalFor(key: string | null | undefined): '#' | 'b' {
  if (!key) return '#';
  return parseKeyName(normalizeKey(key))?.accidental ?? '#';
}

/**
 * Transposes a parsed ChordPro song by `semitones`, keeping sharp/flat
 * spelling consistent with the (explicit or embedded) key rather than
 * chordsheetjs's default, and normalizing the resulting `.key` to one of
 * the standard 15 (chordsheetjs's own key-tracking can otherwise land on
 * an unrepresentable spelling like "B#" — see keys.ts).
 *
 * This is a low-level building block, not what application code should
 * call directly: repeatedly applying small deltas here is exactly the
 * pattern that let the underlying bug compound in the first place. Use
 * transposeChordProToKey (a single call from the stored key to an
 * explicit target key) instead.
 */
export function transposeChordPro(song: Song, semitones: number, options: TransposeOptions = {}): Song {
  const effectiveKey = options.key ?? song.key ?? undefined;
  const target = options.key ? song.setKey(options.key) : song;
  const transposed = target.transpose(semitones, { accidental: accidentalFor(effectiveKey) });
  return transposed.key ? transposed.setKey(normalizeKey(transposed.key)) : transposed;
}

/**
 * The one entry point application code should use: transposes `song` from
 * `fromKey` directly to `toKey` in a single step, always landing exactly
 * on `toKey`'s standard spelling — never a cumulative sequence of small
 * deltas, which is what let enharmonic drift compound into keys like "B#"
 * that this app can never select as a target in the first place. `toKey`
 * must be one of the standard 15 (packages/chords/src/keys.ts); `fromKey`
 * is normalized first, so a legacy-invalid stored key is still a valid
 * starting point.
 */
export function transposeChordProToKey(song: Song, fromKey: string, toKey: string): Song {
  const toInfo = parseKeyName(toKey);
  if (!toInfo) {
    throw new Error(`"${toKey}" is not one of the standard 15 keys this app supports as a transpose target`);
  }
  const fromInfo = parseKeyName(normalizeKey(fromKey))!;
  const semitones = ((toInfo.semitone - fromInfo.semitone) % 12 + 12) % 12;
  const transposed = song.setKey(fromKey).transpose(semitones, { accidental: toInfo.accidental });
  return transposed.setKey(toKey);
}
