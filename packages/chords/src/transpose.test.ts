// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseChordPro } from './parse';
import { transposeChordPro } from './transpose';
import { buildRenderModel } from './render';

function chordsOf(song: ReturnType<typeof parseChordPro>): string[] {
  return buildRenderModel(song)
    .sections.flatMap((s) => s.lines.flatMap((l) => l.segments))
    .flatMap((seg) => (seg.chord ? [seg.chord] : []));
}

const sharpSource = '{key: E}\n[E]one [F#]two [G#m]three [A]four';
const flatSource = '{key: Bb}\n[Bb]one [C]two [Dm]three [Eb]four';

describe('transposeChordPro', () => {
  it('keeps a sharp-spelled key sharp-spelled after transposing', () => {
    const song = parseChordPro(sharpSource);
    const chords = chordsOf(transposeChordPro(song, 2));
    expect(chords.some((c) => c.includes('b'))).toBe(false);
  });

  it('keeps a flat-spelled key flat-spelled after transposing, never mixing sharps in', () => {
    const song = parseChordPro(flatSource);
    const chords = chordsOf(transposeChordPro(song, 2));
    expect(chords.some((c) => c.includes('#'))).toBe(false);
  });

  it('round-trips +5 then -5 back to the exact original spelling (sharp key)', () => {
    const song = parseChordPro(sharpSource);
    const original = chordsOf(song);
    const roundTripped = chordsOf(transposeChordPro(transposeChordPro(song, 5), -5));
    expect(roundTripped).toEqual(original);
  });

  it('round-trips +5 then -5 back to the exact original spelling (flat key)', () => {
    const song = parseChordPro(flatSource);
    const original = chordsOf(song);
    const roundTripped = chordsOf(transposeChordPro(transposeChordPro(song, 5), -5));
    expect(roundTripped).toEqual(original);
  });

  it('transpose(0) is a true no-op', () => {
    const song = parseChordPro(sharpSource);
    expect(chordsOf(transposeChordPro(song, 0))).toEqual(chordsOf(song));
    expect(transposeChordPro(song, 0).key).toBe(song.key);
  });

  it('an explicit key option overrides the embedded {key:} directive', () => {
    // Embedded key is E (sharp-spelled); force flat spelling via an explicit
    // flat key so the transposed chords must come out flat, not sharp.
    const song = parseChordPro(sharpSource);
    const chords = chordsOf(transposeChordPro(song, 2, { key: 'Bb' }));
    expect(chords.some((c) => c.includes('b'))).toBe(true);
    expect(chords.some((c) => c.includes('#'))).toBe(false);
  });
});
