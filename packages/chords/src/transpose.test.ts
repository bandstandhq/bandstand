// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseChordPro } from './parse';
import { STANDARD_KEYS, isStandardKey } from './keys';
import { transposeChordPro, transposeChordProToKey } from './transpose';
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

// The exact seed content of "Amazing Grace" (apps/server/src/seed/songs.ts)
// — kept inline rather than imported, since packages/chords doesn't (and
// shouldn't) depend on apps/server.
const AMAZING_GRACE = [
  '{title: Amazing Grace}',
  '{key: G}',
  '{start_of_verse}',
  '[G]Amazing [G7]grace, how [C]sweet the [G]sound',
  'That [G]saved a [Em]wretch like [D]me',
  'I [G]once was [G7]lost, but [C]now am [G]found',
  'Was [G]blind but [D]now I [G]see',
  '{end_of_verse}',
].join('\n');

const MAJOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'major').map((k) => k.name);
const MINOR_KEYS = STANDARD_KEYS.filter((k) => k.mode === 'minor').map((k) => k.name);

describe('transposeChordProToKey', () => {
  it('reaches C from Amazing Grace\'s seed key (G), by name', () => {
    const song = parseChordPro(AMAZING_GRACE);
    const transposed = transposeChordProToKey(song, 'G', 'C');
    expect(transposed.key).toBe('C');
    const chords = chordsOf(transposed);
    expect(chords).toContain('C');
    expect(chords).toContain('F');
    expect(chords.some((c) => c.includes('#') || c === 'B#')).toBe(false);
  });

  it('reaches G from C, the reverse direction', () => {
    const song = parseChordPro(AMAZING_GRACE);
    const toC = transposeChordProToKey(song, 'G', 'C');
    const backToG = transposeChordProToKey(toC, 'C', 'G');
    expect(backToG.key).toBe('G');
    expect(chordsOf(backToG)).toEqual(chordsOf(song));
  });

  it('spells the target key\'s accidentals, not the source key\'s — F major gets Bb, not A#', () => {
    // G major (sharp-spelled source); its IV chord (C) becomes F major's
    // IV chord (Bb) once transposed. The old bug spelled this "A#" because
    // it picked sharp/flat from the *source* key.
    const song = parseChordPro('{key: G}\n[G]a [C]b [D]c [Em]d');
    const chords = chordsOf(transposeChordProToKey(song, 'G', 'F'));
    expect(chords).toContain('Bb');
    expect(chords.some((c) => c.includes('#'))).toBe(false);
  });

  it('spells the target key\'s accidentals, not the source key\'s — E major gets F#, not Gb', () => {
    // Bb major (flat-spelled source); its I chord (Bb) becomes E major's
    // IV chord (A)... use a chord landing on the F#/Gb pitch instead: Bb
    // major's C becomes F# once transposed to E. The old bug spelled this
    // "Gb" because it picked sharp/flat from the *source* key.
    const song = parseChordPro('{key: Bb}\n[Bb]a [C]b [Eb]c [F]d');
    const chords = chordsOf(transposeChordProToKey(song, 'Bb', 'E'));
    expect(chords).toContain('F#');
    expect(chords.some((c) => c.includes('b'))).toBe(false);
  });

  it('twelve semitones up (cycling through all 15 major keys back to the start) returns the exact original spelling', () => {
    const song = parseChordPro(AMAZING_GRACE);
    const original = chordsOf(song);
    let current = song;
    let currentKey = 'G';
    // G -> Ab -> A -> Bb -> B -> C -> C# -> D -> Eb -> E -> F -> F# -> G:
    // twelve standard-key steps, one semitone each, twelve single-shot
    // transposes from whatever the previous step landed on.
    const path = ['Ab', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G'];
    for (const nextKey of path) {
      current = transposeChordProToKey(current, currentKey, nextKey);
      currentKey = nextKey;
    }
    expect(currentKey).toBe('G');
    expect(chordsOf(current)).toEqual(original);
    expect(current.key).toBe('G');
  });

  const MINOR_TEST_SOURCES: Record<string, string> = {
    Am: '{key: Am}\n[Am]a [Dm]b [E7]c [G]d',
    Em: '{key: Em}\n[Em]a [Am]b [B7]c [D]d',
    Dm: '{key: Dm}\n[Dm]a [Gm]b [A7]c [C]d',
    Gm: '{key: Gm}\n[Gm]a [Cm]b [D7]c [F]d',
  };

  it.each(Object.entries(MINOR_TEST_SOURCES))(
    'minor keys transpose the same way: %s round-trips through a full circle',
    (fromKey, source) => {
      const song = parseChordPro(source);
      const original = chordsOf(song);
      const up = transposeChordProToKey(song, fromKey, 'C#m');
      const backDown = transposeChordProToKey(up, 'C#m', fromKey);
      expect(chordsOf(backDown)).toEqual(original);
      expect(backDown.key).toBe(fromKey);
    },
  );

  describe('every major key to every other major key', () => {
    const pairs = MAJOR_KEYS.flatMap((from) => MAJOR_KEYS.map((to) => [from, to] as const));

    it.each(pairs)('%s -> %s lands on a standard key, never B#/E#/Fb', (from, to) => {
      const song = parseChordPro(`{key: ${from}}\n[${from}]a`);
      const transposed = transposeChordProToKey(song, from, to);
      expect(transposed.key).toBe(to);
      expect(isStandardKey(transposed.key!)).toBe(true);
      expect(transposed.key).not.toMatch(/^(B#|E#|Fb)$/);
    });
  });

  describe('every minor key to every other minor key', () => {
    const pairs = MINOR_KEYS.flatMap((from) => MINOR_KEYS.map((to) => [from, to] as const));

    it.each(pairs)('%s -> %s lands on a standard key, never B#m/E#m/Fbm', (from, to) => {
      const song = parseChordPro(`{key: ${from}}\n[${from}]a`);
      const transposed = transposeChordProToKey(song, from, to);
      expect(transposed.key).toBe(to);
      expect(isStandardKey(transposed.key!)).toBe(true);
      expect(transposed.key).not.toMatch(/^(B#|E#|Fb)m$/);
    });
  });

  it('throws for a target key outside the standard 15 (never a selectable target)', () => {
    const song = parseChordPro(AMAZING_GRACE);
    expect(() => transposeChordProToKey(song, 'G', 'B#')).toThrow();
  });

  // Regression test for issue #265: the song editor's Key letter dropdown
  // offers Db/Gb/Cb (major-only alternate spellings), and its Major/Minor
  // toggle reuses whatever letter is currently selected — so transposing
  // to "Dbm"/"Gbm"/"Cbm" is a real, UI-reachable request, not a made-up
  // input. Before the fix, none of the three existed in STANDARD_KEYS at
  // all, so this threw "Couldn't transpose" for a perfectly valid song.
  it.each(['Dbm', 'Gbm', 'Cbm'])('reaches the flat-spelled minor target %s without throwing', (target) => {
    const song = parseChordPro('{key: Am}\n[Am]a [Dm]b [E7]c [G]d');
    const transposed = transposeChordProToKey(song, 'Am', target);
    expect(transposed.key).toBe(target);
    expect(chordsOf(transposed).some((c) => c.includes('#'))).toBe(false);
  });

  it('round-trips through the newly-reachable Dbm and back to the exact original', () => {
    const song = parseChordPro('{key: Am}\n[Am]a [Dm]b [E7]c [G]d');
    const original = chordsOf(song);
    const toDbm = transposeChordProToKey(song, 'Am', 'Dbm');
    const backToAm = transposeChordProToKey(toDbm, 'Dbm', 'Am');
    expect(backToAm.key).toBe('Am');
    expect(chordsOf(backToAm)).toEqual(original);
  });

  it('accepts a legacy-invalid stored source key by normalizing it first', () => {
    const song = parseChordPro('{key: B#}\n[B#]a [F]b');
    const transposed = transposeChordProToKey(song, 'B#', 'D');
    expect(transposed.key).toBe('D');
  });
});
