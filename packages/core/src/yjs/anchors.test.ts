// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createAnchor, deleteAnchor, listAnchorsForSong, reorderAnchors, updateAnchor } from './anchors';

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
