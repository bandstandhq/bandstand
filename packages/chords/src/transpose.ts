// SPDX-License-Identifier: Apache-2.0
import type { Song } from 'chordsheetjs';

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

function accidentalFor(key: string | null | undefined): '#' | 'b' {
  return key?.includes('b') ? 'b' : '#';
}

/**
 * Transposes a parsed ChordPro song by `semitones`, keeping sharp/flat
 * spelling consistent with the (explicit or embedded) key rather than
 * chordsheetjs's default. An explicit `options.key` always wins over the
 * song's own embedded `{key:}` directive and is applied via `song.setKey`
 * before transposing.
 */
export function transposeChordPro(song: Song, semitones: number, options: TransposeOptions = {}): Song {
  const effectiveKey = options.key ?? song.key ?? undefined;
  const target = options.key ? song.setKey(options.key) : song;
  return target.transpose(semitones, { accidental: accidentalFor(effectiveKey) });
}
