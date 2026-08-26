// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { Anchor } from '../schemas/anchor';
import {
  createAnchor,
  deleteAnchor,
  listAnchorsForSong,
  matchAnchorsToChordProSections,
  reorderAnchors,
  updateAnchor,
} from './anchors';

describe('anchors CRUD', () => {
  it('creates anchors with increasing order and lists them sorted', () => {
    const doc = new Y.Doc();
    const id1 = createAnchor(doc, 's1', { label: 'Intro' });
    const id2 = createAnchor(doc, 's1', { label: 'Verse' });
    const id3 = createAnchor(doc, 's1', { label: 'Chorus', bar: 17 });

    const anchors = listAnchorsForSong(doc, 's1');
    expect(anchors.map((a) => a.id)).toEqual([id1, id2, id3]);
    expect(anchors.map((a) => a.order)).toEqual([0, 1, 2]);
    expect(anchors[2]?.bar).toBe(17);
  });

  it('scopes anchors per song', () => {
    const doc = new Y.Doc();
    createAnchor(doc, 's1', { label: 'Intro' });
    createAnchor(doc, 's2', { label: 'Only in s2' });

    expect(listAnchorsForSong(doc, 's1')).toHaveLength(1);
    expect(listAnchorsForSong(doc, 's2')).toHaveLength(1);
  });

  it('updates an anchor by id without disturbing others', () => {
    const doc = new Y.Doc();
    const id1 = createAnchor(doc, 's1', { label: 'Intro' });
    const id2 = createAnchor(doc, 's1', { label: 'Verse' });

    updateAnchor(doc, 's1', id2, { label: 'Verse 1', bar: 9 });

    const anchors = listAnchorsForSong(doc, 's1');
    expect(anchors.find((a) => a.id === id1)?.label).toBe('Intro');
    expect(anchors.find((a) => a.id === id2)).toMatchObject({ label: 'Verse 1', bar: 9 });
  });

  it('throws updating a nonexistent anchor', () => {
    const doc = new Y.Doc();
    expect(() => updateAnchor(doc, 's1', 'nope', { label: 'x' })).toThrow();
  });

  it('deletes an anchor by id; deleting a nonexistent one is a no-op', () => {
    const doc = new Y.Doc();
    const id1 = createAnchor(doc, 's1', { label: 'Intro' });
    createAnchor(doc, 's1', { label: 'Verse' });

    deleteAnchor(doc, 's1', id1);
    expect(listAnchorsForSong(doc, 's1').map((a) => a.label)).toEqual(['Verse']);

    expect(() => deleteAnchor(doc, 's1', 'nope')).not.toThrow();
  });

  it('reorders anchors to match the given id order, renumbering `order` contiguously', () => {
    const doc = new Y.Doc();
    const id1 = createAnchor(doc, 's1', { label: 'Intro' });
    const id2 = createAnchor(doc, 's1', { label: 'Verse' });
    const id3 = createAnchor(doc, 's1', { label: 'Chorus' });

    reorderAnchors(doc, 's1', [id3, id1, id2]);

    const anchors = listAnchorsForSong(doc, 's1');
    expect(anchors.map((a) => a.id)).toEqual([id3, id1, id2]);
    expect(anchors.map((a) => a.order)).toEqual([0, 1, 2]);
  });

  it('reorder silently drops ids that no longer exist', () => {
    const doc = new Y.Doc();
    const id1 = createAnchor(doc, 's1', { label: 'Intro' });
    const id2 = createAnchor(doc, 's1', { label: 'Verse' });

    reorderAnchors(doc, 's1', [id2, 'nonexistent', id1]);

    expect(listAnchorsForSong(doc, 's1').map((a) => a.id)).toEqual([id2, id1]);
  });
});

describe('matchAnchorsToChordProSections', () => {
  const anchors: Anchor[] = [
    { id: 'a1', label: 'Intro', order: 0 },
    { id: 'a2', label: 'Chorus', order: 1 },
    { id: 'a3', label: 'Bridge', order: 2 },
  ];

  it('matches an anchor to the section with the same label', () => {
    const sections = [{ label: 'Intro' }, { label: 'Verse 1' }, { label: 'Chorus' }];
    const result = matchAnchorsToChordProSections(anchors, sections);
    expect(result.get('a1')).toBe(0);
    expect(result.get('a2')).toBe(2);
  });

  it('matches case- and whitespace-insensitively', () => {
    const sections = [{ label: '  CHORUS  ' }];
    expect(matchAnchorsToChordProSections(anchors, sections).get('a2')).toBe(0);
  });

  it('leaves an anchor with no matching section absent from the result', () => {
    const sections = [{ label: 'Intro' }];
    const result = matchAnchorsToChordProSections(anchors, sections);
    expect(result.has('a1')).toBe(true);
    expect(result.has('a2')).toBe(false);
    expect(result.has('a3')).toBe(false);
  });

  it('returns an empty map for an empty anchor list or no labeled sections', () => {
    expect(matchAnchorsToChordProSections([], [{ label: 'Intro' }]).size).toBe(0);
    expect(matchAnchorsToChordProSections(anchors, [{ label: null }, { label: null }]).size).toBe(0);
  });

  it('matches the first occurrence when multiple sections share a label', () => {
    const sections = [{ label: 'Verse' }, { label: 'Chorus' }, { label: 'Chorus' }];
    expect(matchAnchorsToChordProSections(anchors, sections).get('a2')).toBe(1);
  });
});
