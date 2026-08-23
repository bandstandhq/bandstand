// SPDX-License-Identifier: Apache-2.0
import { ChordProFormatter } from 'chordsheetjs';
import type { Song } from 'chordsheetjs';

/** Serializes a (possibly transposed) parsed song back to ChordPro text. */
export function formatChordPro(song: Song): string {
  return new ChordProFormatter().format(song);
}
