// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { collectUpcomingFileHashes, isUpcomingSetlist } from './offline';
import { addSetlistItem, buildSongItem, createSetlist } from './setlists';
import { createVoice } from './voices';

const TODAY = new Date('2026-08-26');
const fileRef = (sha256: string) => ({ sha256, filename: 'part.pdf', mime: 'application/pdf', pageCount: 1 });

describe('isUpcomingSetlist', () => {
  it('treats no date at all as upcoming', () => {
    expect(isUpcomingSetlist(undefined, TODAY)).toBe(true);
  });

  it('treats today and future dates as upcoming', () => {
    expect(isUpcomingSetlist('2026-08-26', TODAY)).toBe(true);
    expect(isUpcomingSetlist('2026-09-01', TODAY)).toBe(true);
  });

  it('treats a past date as not upcoming', () => {
    expect(isUpcomingSetlist('2026-01-01', TODAY)).toBe(false);
  });
});

describe('collectUpcomingFileHashes', () => {
  it('collects file hashes from every voice of a song in an upcoming (undated) setlist', () => {
    const doc = new Y.Doc();
    const voiceId = createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    const setlistId = createSetlist(doc, 'Undated Practice Set');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual(['a'.repeat(64)]);
    expect(voiceId).toBeDefined();
  });

  it('ignores a song that is only on a past-dated setlist', () => {
    const doc = new Y.Doc();
    createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    const setlistId = createSetlist(doc, 'Last Year', '2025-01-01');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual([]);
  });

  it('includes a song referenced by both a past and an upcoming setlist', () => {
    const doc = new Y.Doc();
    createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });
    const pastId = createSetlist(doc, 'Last Year', '2025-01-01');
    addSetlistItem(doc, pastId, buildSongItem('song-1'));
    const upcomingId = createSetlist(doc, 'Next Show', '2026-09-01');
    addSetlistItem(doc, upcomingId, buildSongItem('song-1'));

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual(['a'.repeat(64)]);
  });

  it('ignores a chordpro voice — nothing to pre-load for it', () => {
    const doc = new Y.Doc();
    createVoice(doc, 'song-1', { name: 'Lead', kind: 'chordpro', body: 'x' });
    const setlistId = createSetlist(doc, 'Practice');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual([]);
  });

  it('deduplicates a hash shared by two voices', () => {
    const doc = new Y.Doc();
    createVoice(doc, 'song-1', { name: 'Trumpet 1', kind: 'files', files: [fileRef('a'.repeat(64))] });
    createVoice(doc, 'song-1', { name: 'Trumpet 2', kind: 'files', files: [fileRef('a'.repeat(64))] });
    const setlistId = createSetlist(doc, 'Practice');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual(['a'.repeat(64)]);
  });

  it('ignores a song that is not on any setlist at all', () => {
    const doc = new Y.Doc();
    createVoice(doc, 'song-1', { name: 'Trumpet', kind: 'files', files: [fileRef('a'.repeat(64))] });

    expect(collectUpcomingFileHashes(doc, TODAY)).toEqual([]);
  });
});
