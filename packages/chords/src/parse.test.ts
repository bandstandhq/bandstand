// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseChordPro } from './parse';
import { buildRenderModel } from './render';

function chordsOf(source: string): string[] {
  const model = buildRenderModel(parseChordPro(source));
  return model.sections.flatMap((s) => s.lines.flatMap((l) => l.segments.flatMap((seg) => (seg.chord ? [seg.chord] : []))));
}

describe('parseChordPro edge cases', () => {
  it('parses a chord-only line with no lyrics, preserving chord order', () => {
    expect(() => parseChordPro('[C]   [G]   [Am]  [F]')).not.toThrow();
    expect(chordsOf('[C]   [G]   [Am]  [F]')).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('preserves the exact split point for a mid-word chord', () => {
    const model = buildRenderModel(parseChordPro('belie[C]ve'));
    const segments = model.sections[0]?.lines[0]?.segments;
    expect(segments).toEqual([
      { chord: null, lyric: 'belie' },
      { chord: 'C', lyric: 've' },
    ]);
  });

  it('parses metadata directives without leaking them into the body', () => {
    const song = parseChordPro('{title: My Song}\n{artist: Someone}\n{key: G}\n[G]Hello');
    expect(song.title).toBe('My Song');
    expect(song.artist).toBe('Someone');
    expect(song.key).toBe('G');
    expect(chordsOf('{title: My Song}\n{artist: Someone}\n{key: G}\n[G]Hello')).toEqual(['G']);
  });

  it('does not throw on an unknown/invalid chord token, passing it through as-is', () => {
    expect(() => parseChordPro('[Xmaj9#11]Hello')).not.toThrow();
    expect(chordsOf('[Xmaj9#11]Hello')).toEqual(['Xmaj9#11']);
  });

  it('parses empty input to a valid, empty render model', () => {
    const model = buildRenderModel(parseChordPro(''));
    expect(model.sections).toEqual([]);
    expect(model.title).toBeNull();
  });

  it('parses directive-only input (no body) without throwing', () => {
    const model = buildRenderModel(parseChordPro('{title: Just Meta}\n{key: C}'));
    expect(model.sections).toEqual([]);
    expect(model.title).toBe('Just Meta');
    expect(model.key).toBe('C');
  });

  it('parses a repeated explicit section, keeping both occurrences intact', () => {
    const source =
      '{start_of_chorus}\n[C]La la\n{end_of_chorus}\nverse line\n{start_of_chorus}\n[C]La la\n{end_of_chorus}';
    const model = buildRenderModel(parseChordPro(source));
    const chorusLines = model.sections.flatMap((s) => s.lines.filter((l) => l.type === 'chorus'));
    expect(chorusLines).toHaveLength(2);
    expect(chorusLines[0]).toEqual(chorusLines[1]);
  });
});
