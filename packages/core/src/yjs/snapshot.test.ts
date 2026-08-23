// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { bandSnapshotSchema, snapshotToYDoc, yDocToSnapshot } from './snapshot';
import type { BandSnapshot } from './snapshot';

const sampleSnapshot: BandSnapshot = {
  songs: {
    's1': {
      title: 'Wonderwall',
      artist: 'Oasis',
      key: 'F#m',
      bpm: 87,
      durationSec: 258,
      status: 'active',
      bandNotes: '',
      links: [],
      votes: { u1: 'up' },
    },
    's2': {
      title: 'Creep',
      artist: 'Radiohead',
      key: 'G',
      bpm: 92,
      durationSec: 238,
      status: 'idea',
      bandNotes: 'maybe for the encore',
      links: ['https://example.com/creep'],
      votes: {},
    },
  },
  voices: {
    'voice:s1': { songId: 's1', name: 'Default', body: '{title: Wonderwall}' },
    'voice:s2': { songId: 's2', name: 'Default', body: '{title: Creep}' },
  },
  setlists: {
    'sl1': {
      name: 'Summer Gig',
      eventDate: '2026-07-04',
      updatedAt: 1000,
      items: [
        { id: 'i1', type: 'song', songId: 's1' },
        { id: 'i2', type: 'break', breakMinutes: 15 },
        { id: 'i3', type: 'song', songId: 's2', overrideKey: 'A' },
        { id: 'i4', type: 'finale' },
      ],
    },
  },
};

describe('yDoc <-> snapshot round-trip', () => {
  it('round-trips the documented shape through a real Y.Doc', () => {
    const doc = snapshotToYDoc(sampleSnapshot);
    const result = yDocToSnapshot(doc);

    expect(() => bandSnapshotSchema.parse(result)).not.toThrow();
    expect(result).toEqual(sampleSnapshot);
  });

  it('orders setlist items via the Y.Array, not a position field', () => {
    const doc = new Y.Doc();
    doc.getMap('setlists').set('sl1', { name: 'Test', updatedAt: 0 });
    const items = doc.getArray('items:sl1');

    items.insert(0, [{ id: 'b', type: 'break', breakMinutes: 5 }]);
    items.push([{ id: 'c', type: 'finale' }]);
    items.insert(1, [{ id: 'a', type: 'song', songId: 's1' }]);

    const snapshot = yDocToSnapshot(doc);
    expect(snapshot.setlists.sl1?.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('rejects a snapshot with an unknown item type', () => {
    const doc = new Y.Doc();
    doc.getMap('setlists').set('sl1', { name: 'Test', updatedAt: 0 });
    doc.getArray('items:sl1').push([{ id: 'x', type: 'encore' }]);

    expect(() => yDocToSnapshot(doc)).toThrow();
  });

  it('rejects a snapshot with a song missing its title', () => {
    const doc = new Y.Doc();
    doc.getMap('songs').set('s1', { ...sampleSnapshot.songs.s1, title: undefined });

    expect(() => yDocToSnapshot(doc)).toThrow();
  });
});
