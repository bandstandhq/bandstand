// SPDX-License-Identifier: Apache-2.0
import { ChordProParser } from 'chordsheetjs';
import type { Song } from 'chordsheetjs';

export function parseChordPro(source: string): Song {
  return new ChordProParser().parse(source);
}
