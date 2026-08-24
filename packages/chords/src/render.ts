// SPDX-License-Identifier: Apache-2.0
import { ChordLyricsPair } from 'chordsheetjs';
import type { Song } from 'chordsheetjs';
import { formatChordPro } from './format';
import { parseChordPro } from './parse';

export interface RenderSegment {
  chord: string | null;
  lyric: string;
}

export interface RenderLine {
  type: string;
  segments: RenderSegment[];
}

export interface RenderSection {
  type: string;
  lines: RenderLine[];
}

export interface RenderModel {
  title: string | null;
  artist: string | null;
  key: string | null;
  sections: RenderSection[];
}

function toSingleString(value: string | string[] | null): string | null {
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Builds a UI-agnostic render model from a parsed ChordPro song: metadata
 * plus sections (one per {start_of_x}/{end_of_x} block or blank-line-
 * separated paragraph) made of lines of chord/lyric segments. This is not
 * final markup — the UI decides how to lay a segment's chord above its
 * lyric syllable.
 *
 * Formats and re-parses `song` first — after `.transpose()`, chordsheetjs
 * can leave a `ChordLyricsPair`'s own `.chords` string stale/mis-spelled
 * (e.g. "B#") even though `ChordProFormatter` renders that same chord
 * correctly ("C"); a fresh parse of the correctly-formatted text doesn't
 * carry that staleness. A transposed song is always small enough that this
 * round-trip is cheap relative to a React render.
 */
export function buildRenderModel(song: Song): RenderModel {
  const normalized = parseChordPro(formatChordPro(song));
  const sections: RenderSection[] = normalized.bodyParagraphs.map((paragraph) => ({
    type: paragraph.type,
    lines: paragraph.lines.map((line) => ({
      type: line.type,
      segments: line.items
        .filter((item): item is ChordLyricsPair => item instanceof ChordLyricsPair)
        .map((pair) => ({
          chord: pair.chords ? pair.chords : null,
          lyric: pair.lyrics ?? '',
        })),
    })),
  }));

  return {
    title: toSingleString(normalized.title),
    artist: toSingleString(normalized.artist),
    key: normalized.key,
    sections,
  };
}
