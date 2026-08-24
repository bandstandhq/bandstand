// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildRenderModel } from './render';
import { parseChordPro } from './parse';
import { transposeChordProToKey } from './transpose';

function chordsOf(model: ReturnType<typeof buildRenderModel>): string[] {
  return model.sections.flatMap((s) => s.lines.flatMap((l) => l.segments)).flatMap((seg) => (seg.chord ? [seg.chord] : []));
}

describe('buildRenderModel', () => {
  it('renders chords correctly, not the stale spelling chordsheetjs can leave on a transposed pair', () => {
    // chordsheetjs's own ChordLyricsPair.chords property can go stale
    // after .transpose() (e.g. reporting "B#" for a chord that
    // ChordProFormatter correctly renders as "C") — buildRenderModel must
    // not surface that staleness to the UI.
    const song = parseChordPro('{key: G}\n[G]a [C]b [D]c');
    const transposed = transposeChordProToKey(song, 'G', 'C');

    const model = buildRenderModel(transposed);
    expect(model.key).toBe('C');
    expect(chordsOf(model)).toEqual(['C', 'F', 'G']);
  });

  it('reports the song key and untransposed chords unchanged when nothing was transposed', () => {
    const song = parseChordPro('{title: Test}\n{artist: Someone}\n{key: G}\n[G]a [D]b');
    const model = buildRenderModel(song);
    expect(model).toMatchObject({
      title: 'Test',
      artist: 'Someone',
      key: 'G',
    });
    expect(chordsOf(model)).toEqual(['G', 'D']);
  });
});
