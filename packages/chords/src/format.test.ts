// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { formatChordPro } from './format';
import { parseChordPro } from './parse';
import { transposeChordPro } from './transpose';

describe('formatChordPro', () => {
  it('round-trips an untransposed song back to equivalent ChordPro', () => {
    const source = '{title: Test}\n{key: G}\n[G]Amazing [C]grace how [D]sweet';
    const song = parseChordPro(source);
    expect(formatChordPro(song)).toBe(source);
  });

  it('reflects a transposition in both the key directive and the chords', () => {
    const song = parseChordPro('{title: Test}\n{key: G}\n[G]Amazing [C]grace how [D]sweet');
    const transposed = transposeChordPro(song, 2, { key: 'G' });

    const output = formatChordPro(transposed);
    expect(output).toContain('{key: A}');
    expect(output).toContain('[A]Amazing [D]grace how [E]sweet');
  });

  it('keeps flat spelling for a flat-spelled key', () => {
    const song = parseChordPro('{key: Bb}\n[Bb]One [Eb]two');
    const transposed = transposeChordPro(song, 1, { key: 'Bb' });

    expect(formatChordPro(transposed)).toContain('[B]One [E]two');
  });
});
