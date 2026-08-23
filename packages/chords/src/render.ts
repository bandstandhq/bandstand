// SPDX-License-Identifier: Apache-2.0
import { ChordLyricsPair } from 'chordsheetjs';
import type { Song } from 'chordsheetjs';

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
 */
export function buildRenderModel(song: Song): RenderModel {
  const sections: RenderSection[] = song.bodyParagraphs.map((paragraph) => ({
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
    title: toSingleString(song.title),
    artist: toSingleString(song.artist),
    key: song.key,
    sections,
  };
}
