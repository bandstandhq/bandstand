// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addSong } from './songs';
import {
  clearVoiceAnchorPosition,
  createVoice,
  detachVoiceFile,
  findRenderedPositionForSourcePage,
  flattenVoiceFiles,
  getAnchorCalibrationProgress,
  getVoice,
  listVoicesForSong,
  resolveDisplaySequence,
  setVoiceAnchorPosition,
  setVoiceDisplayRecipe,
  updateVoiceBody,
} from './voices';
import { getDefaultVoiceId } from '../schemas/voice';
import type { Anchor } from '../schemas/anchor';

const fileRef = (sha256: string, pageCount = 1) => ({ sha256, filename: 'part.pdf', mime: 'application/pdf', pageCount });

describe('getVoice / updateVoiceBody', () => {
  it('reads the voice created by addSong', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });

    const voice = getVoice(doc, getDefaultVoiceId(songId));
    expect(voice?.kind === 'chordpro' ? voice.body : undefined).toBe('original');
  });

  it('updates only the body, preserving songId/name', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });
    const voiceId = getDefaultVoiceId(songId);

    updateVoiceBody(doc, voiceId, 'updated content');

    const voice = getVoice(doc, voiceId);
    expect(voice).toEqual({ songId, name: 'Default', kind: 'chordpro', body: 'updated content' });
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => updateVoiceBody(doc, 'missing', 'x')).toThrow('Voice not found');
  });
});

describe('listVoicesForSong / createVoice', () => {
  it('lists only voices for the given song, in insertion order', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });
    const otherSongId = addSong(doc, {
      title: 'Other',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'other',
    });
    const trumpetId = createVoice(doc, songId, {
      name: 'Trumpet in B',
      kind: 'files',
      instrument: 'Trumpet',
      files: [fileRef('a'.repeat(64))],
    });

    const voices = listVoicesForSong(doc, songId);
    expect(voices.map((v) => v.id)).toEqual([getDefaultVoiceId(songId), trumpetId]);
    expect(listVoicesForSong(doc, otherSongId)).toHaveLength(1);
  });

  it('creates a files voice with a fresh id, distinct from the default voice id', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, {
      title: 'Song',
      artist: '',
      key: 'C',
      bpm: 100,
      durationSec: 100,
      status: 'active',
      body: 'original',
    });

    const voiceId = createVoice(doc, songId, { name: 'Trombone', kind: 'files', files: [fileRef('b'.repeat(64))] });

    expect(voiceId).not.toBe(getDefaultVoiceId(songId));
    const voice = getVoice(doc, voiceId);
    expect(voice).toEqual({ songId, name: 'Trombone', kind: 'files', files: [fileRef('b'.repeat(64))] });
  });
});

describe('detachVoiceFile', () => {
  it('removes one file, keeping the rest', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', {
      name: 'Trumpet',
      kind: 'files',
      files: [fileRef('a'.repeat(64)), fileRef('b'.repeat(64))],
    });

    detachVoiceFile(doc, voiceId, 'a'.repeat(64));

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.files.map((f) => f.sha256) : []).toEqual(['b'.repeat(64)]);
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => detachVoiceFile(doc, 'missing', 'a'.repeat(64))).toThrow('Voice not found');
  });

  it('throws for a chordpro voice', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    expect(() => detachVoiceFile(doc, voiceId, 'a'.repeat(64))).toThrow('not a files voice');
  });

  it('throws when removing the last file, since a files voice needs at least one', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    expect(() => detachVoiceFile(doc, voiceId, 'a'.repeat(64))).toThrow();
  });

  it('clears an existing display recipe, since its page indices no longer line up', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', {
      name: 'Trumpet',
      kind: 'files',
      files: [fileRef('a'.repeat(64), 2), fileRef('b'.repeat(64))],
    });
    setVoiceDisplayRecipe(doc, voiceId, { pageOrder: [0, 1, 2] });

    detachVoiceFile(doc, voiceId, 'a'.repeat(64));

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.displayRecipe : 'not-a-files-voice').toBeUndefined();
  });

  it('also clears an existing anchorMap, for the same reason (fileIndex shifts, not just page indices)', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', {
      name: 'Trumpet',
      kind: 'files',
      files: [fileRef('a'.repeat(64), 2), fileRef('b'.repeat(64))],
    });
    setVoiceAnchorPosition(doc, voiceId, 'anchor-1', { fileIndex: 1, page: 1, yPct: 0.5 });

    detachVoiceFile(doc, voiceId, 'a'.repeat(64));

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.anchorMap : 'not-a-files-voice').toBeUndefined();
  });
});

describe('flattenVoiceFiles', () => {
  it('assigns sequential original indices across multiple files, and each page its file\'s index', () => {
    const files = [fileRef('a'.repeat(64), 2), fileRef('b'.repeat(64), 1)];
    const pages = flattenVoiceFiles(files);
    expect(pages).toEqual([
      { originalIndex: 0, fileIndex: 0, file: files[0], pageNumberInFile: 1 },
      { originalIndex: 1, fileIndex: 0, file: files[0], pageNumberInFile: 2 },
      { originalIndex: 2, fileIndex: 1, file: files[1], pageNumberInFile: 1 },
    ]);
  });
});

describe('resolveDisplaySequence', () => {
  const files = [fileRef('a'.repeat(64), 2), fileRef('b'.repeat(64), 1)];

  it('defaults to natural order with no rotation when there is no recipe', () => {
    const sequence = resolveDisplaySequence(files);
    expect(sequence.map((p) => [p.originalIndex, p.rotation])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('reorders pages per pageOrder', () => {
    const sequence = resolveDisplaySequence(files, { pageOrder: [2, 0, 1] });
    expect(sequence.map((p) => p.originalIndex)).toEqual([2, 0, 1]);
    expect(sequence.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it('duplicates a page by repeating its original index in pageOrder', () => {
    const sequence = resolveDisplaySequence(files, { pageOrder: [0, 0, 1, 2] });
    expect(sequence.map((p) => p.originalIndex)).toEqual([0, 0, 1, 2]);
    // Each occurrence gets its own position, so duplicates are distinguishable.
    expect(sequence.map((p) => p.position)).toEqual([0, 1, 2, 3]);
  });

  it('looks up each page\'s rotation by its original index', () => {
    const sequence = resolveDisplaySequence(files, { rotations: { '1': 90, '2': 180 } });
    expect(sequence.map((p) => p.rotation)).toEqual([0, 90, 180]);
  });

  it('ignores an out-of-range page index rather than throwing', () => {
    const sequence = resolveDisplaySequence(files, { pageOrder: [0, 99, 1] });
    expect(sequence.map((p) => p.originalIndex)).toEqual([0, 1]);
  });
});

describe('setVoiceDisplayRecipe', () => {
  it('persists a display recipe on a files voice', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });

    setVoiceDisplayRecipe(doc, voiceId, { rotations: { '0': 90 } });

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.displayRecipe : undefined).toEqual({ rotations: { '0': 90 } });
  });

  it('throws for a nonexistent voice', () => {
    const doc = new Y.Doc();
    expect(() => setVoiceDisplayRecipe(doc, 'missing', {})).toThrow('Voice not found');
  });

  it('throws for a chordpro voice', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    expect(() => setVoiceDisplayRecipe(doc, voiceId, {})).toThrow('not a files voice');
  });
});

describe('findRenderedPositionForSourcePage', () => {
  const files = [fileRef('a'.repeat(64), 2), fileRef('b'.repeat(64), 1)];

  it('finds a source page at its natural position with no recipe', () => {
    const resolved = findRenderedPositionForSourcePage(files, undefined, 1, 1);
    expect(resolved).toMatchObject({ position: 2, fileIndex: 1, pageNumberInFile: 1 });
  });

  it('still resolves correctly after the pages are reordered', () => {
    // Original order: [file0-p1, file0-p2, file1-p1] at originalIndex [0,1,2].
    // Reordered so file1-p1 (originalIndex 2) now renders first.
    const resolved = findRenderedPositionForSourcePage(files, { pageOrder: [2, 0, 1] }, 1, 1);
    expect(resolved?.position).toBe(0);
  });

  it('resolves to the first occurrence when the source page was duplicated', () => {
    const resolved = findRenderedPositionForSourcePage(files, { pageOrder: [0, 0, 1, 2] }, 0, 1);
    expect(resolved?.position).toBe(0);
  });

  it('returns undefined when the source page no longer exists in the recipe', () => {
    const resolved = findRenderedPositionForSourcePage(files, { pageOrder: [0, 1] }, 1, 1);
    expect(resolved).toBeUndefined();
  });
});

describe('setVoiceAnchorPosition / clearVoiceAnchorPosition', () => {
  it('adds an anchor position without disturbing other entries', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64), 2)] });

    setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 1, yPct: 0.1 });
    setVoiceAnchorPosition(doc, voiceId, 'a2', { fileIndex: 0, page: 2, yPct: 0.8 });

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.anchorMap : undefined).toEqual({
      a1: { fileIndex: 0, page: 1, yPct: 0.1 },
      a2: { fileIndex: 0, page: 2, yPct: 0.8 },
    });
  });

  it('overwrites an existing position for the same anchor', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64), 2)] });
    setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 1, yPct: 0.1 });

    setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 2, yPct: 0.9 });

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.anchorMap?.a1 : undefined).toEqual({ fileIndex: 0, page: 2, yPct: 0.9 });
  });

  it('clears one anchor, leaving the rest', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64), 2)] });
    setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 1, yPct: 0.1 });
    setVoiceAnchorPosition(doc, voiceId, 'a2', { fileIndex: 0, page: 2, yPct: 0.8 });

    clearVoiceAnchorPosition(doc, voiceId, 'a1');

    const voice = getVoice(doc, voiceId);
    expect(voice?.kind === 'files' ? voice.anchorMap : undefined).toEqual({ a2: { fileIndex: 0, page: 2, yPct: 0.8 } });
  });

  it('clearing a nonexistent entry, or on a voice with no anchorMap at all, is a no-op', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    expect(() => clearVoiceAnchorPosition(doc, voiceId, 'nope')).not.toThrow();
  });

  it('throws for a chordpro voice — it never stores an anchorMap', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    expect(() => setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 1, yPct: 0 })).toThrow(
      'not a files voice',
    );
  });
});

describe('getAnchorCalibrationProgress', () => {
  const anchors: Anchor[] = [
    { id: 'a1', label: 'Intro', order: 0 },
    { id: 'a2', label: 'Chorus', order: 1 },
  ];

  it('counts anchorMap entries for a files voice', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    setVoiceAnchorPosition(doc, voiceId, 'a1', { fileIndex: 0, page: 1, yPct: 0 });

    const voice = getVoice(doc, voiceId)!;
    expect(getAnchorCalibrationProgress(voice, anchors)).toEqual({ done: 1, total: 2 });
  });

  it('counts matched sections for a chordpro voice, given sections', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    const voice = getVoice(doc, voiceId)!;

    const progress = getAnchorCalibrationProgress(voice, anchors, [{ label: 'Intro' }, { label: 'Bridge' }]);
    expect(progress).toEqual({ done: 1, total: 2 });
  });

  it('reports zero done for a chordpro voice when no sections are given', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    const voice = getVoice(doc, voiceId)!;

    expect(getAnchorCalibrationProgress(voice, anchors)).toEqual({ done: 0, total: 2 });
  });
});
