// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { Song } from '../schemas/song';
import type { SetlistItem } from '../schemas/setlistItem';
import { itemsKey } from './snapshot';
import {
  addSetlistItem,
  buildBreakItem,
  buildFinaleItem,
  buildSongItem,
  createSetlist,
  deleteSetlist,
  duplicateSetlist,
  findSetlistsReferencingSong,
  getSetlistStats,
  insertSetlistItem,
  moveSetlistItem,
  removeSetlistItem,
  removeSongFromAllSetlists,
  renameSetlist,
} from './setlists';

describe('createSetlist / renameSetlist', () => {
  it('creates a setlist with the given name', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Open Mic Night', '2026-09-12');

    const setlist = doc.getMap('setlists').get(setlistId) as Record<string, unknown>;
    expect(setlist.name).toBe('Open Mic Night');
    expect(setlist.eventDate).toBe('2026-09-12');
  });

  it('renames and bumps updatedAt', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Draft');
    const before = (doc.getMap('setlists').get(setlistId) as { updatedAt: number }).updatedAt;

    renameSetlist(doc, setlistId, 'Final Set');

    const after = doc.getMap('setlists').get(setlistId) as { name: string; updatedAt: number };
    expect(after.name).toBe('Final Set');
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('throws renaming a nonexistent setlist', () => {
    const doc = new Y.Doc();
    expect(() => renameSetlist(doc, 'missing', 'x')).toThrow('Setlist not found');
  });
});

describe('item builders + addSetlistItem', () => {
  it('appends song/break/finale items in order', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');

    addSetlistItem(doc, setlistId, buildSongItem('song-1'));
    addSetlistItem(doc, setlistId, buildBreakItem(15));
    addSetlistItem(doc, setlistId, buildSongItem('song-2', 'D'));
    addSetlistItem(doc, setlistId, buildFinaleItem());

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => i.type)).toEqual(['song', 'break', 'song', 'finale']);
    expect(items[2]).toMatchObject({ songId: 'song-2', overrideKey: 'D' });
  });
});

describe('insertSetlistItem', () => {
  it('inserts at the given index, not always at the end', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));
    addSetlistItem(doc, setlistId, buildSongItem('song-2'));
    addSetlistItem(doc, setlistId, buildSongItem('song-3'));

    insertSetlistItem(doc, setlistId, buildSongItem('song-new'), 1);

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => (i.type === 'song' ? i.songId : i.type))).toEqual([
      'song-1',
      'song-new',
      'song-2',
      'song-3',
    ]);
  });

  it('clamps a too-large index to the end', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    insertSetlistItem(doc, setlistId, buildSongItem('song-new'), 99);

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => (i.type === 'song' ? i.songId : i.type))).toEqual(['song-1', 'song-new']);
  });

  it('clamps a negative index to the start', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    insertSetlistItem(doc, setlistId, buildSongItem('song-new'), -5);

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => (i.type === 'song' ? i.songId : i.type))).toEqual(['song-new', 'song-1']);
  });
});

describe('removeSetlistItem', () => {
  it('removes exactly the matching item by id', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    const a = buildSongItem('song-a');
    const b = buildSongItem('song-b');
    addSetlistItem(doc, setlistId, a);
    addSetlistItem(doc, setlistId, b);

    removeSetlistItem(doc, setlistId, a.id);

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => i.id)).toEqual([b.id]);
  });

  it('is a no-op for an unknown item id', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    addSetlistItem(doc, setlistId, buildSongItem('song-a'));

    expect(() => removeSetlistItem(doc, setlistId, 'nonexistent')).not.toThrow();
    expect(doc.getArray(itemsKey(setlistId)).length).toBe(1);
  });
});

describe('moveSetlistItem', () => {
  it('reorders items via the Y.Array, not a position field', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    const a = buildSongItem('a');
    const b = buildSongItem('b');
    const c = buildSongItem('c');
    addSetlistItem(doc, setlistId, a);
    addSetlistItem(doc, setlistId, b);
    addSetlistItem(doc, setlistId, c);

    moveSetlistItem(doc, setlistId, c.id, 0);

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it('is a no-op moving to the same index', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Set 1');
    const a = buildSongItem('a');
    addSetlistItem(doc, setlistId, a);

    moveSetlistItem(doc, setlistId, a.id, 0);
    expect(doc.getArray(itemsKey(setlistId)).length).toBe(1);
  });
});

describe('duplicateSetlist', () => {
  it('copies name and item order, drops eventDate, assigns fresh item ids', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Original', '2026-01-01');
    const original = buildSongItem('song-1');
    addSetlistItem(doc, setlistId, original);

    const copyId = duplicateSetlist(doc, setlistId);

    const copy = doc.getMap('setlists').get(copyId) as { name: string; eventDate?: string };
    expect(copy.name).toBe('Original');
    expect(copy.eventDate).toBeUndefined();

    const copiedItems = doc.getArray(itemsKey(copyId)).toJSON() as SetlistItem[];
    expect(copiedItems).toHaveLength(1);
    expect(copiedItems[0]).toMatchObject({ type: 'song', songId: 'song-1' });
    expect(copiedItems[0]!.id).not.toBe(original.id);
  });
});

describe('deleteSetlist', () => {
  it('removes the setlist entry and clears its items array', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Temp');
    addSetlistItem(doc, setlistId, buildSongItem('song-1'));

    deleteSetlist(doc, setlistId);

    expect(doc.getMap('setlists').has(setlistId)).toBe(false);
    expect(doc.getArray(itemsKey(setlistId)).length).toBe(0);
  });
});

describe('findSetlistsReferencingSong', () => {
  it('names every setlist that references the song, without modifying anything', () => {
    const doc = new Y.Doc();
    const setlistId1 = createSetlist(doc, 'Set 1');
    const setlistId2 = createSetlist(doc, 'Set 2');
    addSetlistItem(doc, setlistId1, buildSongItem('song-y'));
    addSetlistItem(doc, setlistId2, buildBreakItem(10));

    expect(findSetlistsReferencingSong(doc, 'song-y')).toEqual(['Set 1']);
    // Untouched — still there for removeSongFromAllSetlists to act on later.
    expect(doc.getArray(itemsKey(setlistId1)).length).toBe(1);
  });

  it('returns no names when nothing references the song', () => {
    const doc = new Y.Doc();
    createSetlist(doc, 'Untouched');
    expect(findSetlistsReferencingSong(doc, 'song-missing')).toEqual([]);
  });
});

describe('removeSongFromAllSetlists', () => {
  it('removes matching song-items from every setlist and reports affected names', () => {
    const doc = new Y.Doc();
    const setlistId1 = createSetlist(doc, 'Set 1');
    const setlistId2 = createSetlist(doc, 'Set 2');
    addSetlistItem(doc, setlistId1, buildSongItem('song-x'));
    addSetlistItem(doc, setlistId1, buildSongItem('song-y'));
    addSetlistItem(doc, setlistId2, buildSongItem('song-y'));
    addSetlistItem(doc, setlistId2, buildBreakItem(10));

    const affected = removeSongFromAllSetlists(doc, 'song-y');

    expect(affected.sort()).toEqual(['Set 1', 'Set 2']);
    const items1 = doc.getArray(itemsKey(setlistId1)).toJSON() as SetlistItem[];
    expect(items1.map((i) => (i.type === 'song' ? i.songId : i.type))).toEqual(['song-x']);
    const items2 = doc.getArray(itemsKey(setlistId2)).toJSON() as SetlistItem[];
    expect(items2.map((i) => i.type)).toEqual(['break']);
  });

  it('removes every occurrence when the same song appears multiple times in one setlist', () => {
    const doc = new Y.Doc();
    const setlistId = createSetlist(doc, 'Repeats');
    addSetlistItem(doc, setlistId, buildSongItem('song-z'));
    addSetlistItem(doc, setlistId, buildBreakItem(5));
    addSetlistItem(doc, setlistId, buildSongItem('song-z'));

    removeSongFromAllSetlists(doc, 'song-z');

    const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];
    expect(items.map((i) => i.type)).toEqual(['break']);
  });

  it('is a no-op, returning no names, when no setlist references the song', () => {
    const doc = new Y.Doc();
    createSetlist(doc, 'Untouched');
    expect(removeSongFromAllSetlists(doc, 'song-missing')).toEqual([]);
  });
});

describe('getSetlistStats', () => {
  const songs: Record<string, Song> = {
    's1': { title: 'A', artist: '', key: 'C', bpm: 120, durationSec: 200, status: 'active', bandNotes: '', links: [], votes: {} },
    's2': { title: 'B', artist: '', key: 'C', bpm: 120, durationSec: 250, status: 'active', bandNotes: '', links: [], votes: {} },
  };

  it('sums song durations and break minutes, counts only songs', () => {
    const items: SetlistItem[] = [
      buildSongItem('s1'),
      buildBreakItem(15),
      buildSongItem('s2'),
      buildFinaleItem(),
    ];

    const stats = getSetlistStats(items, songs);
    expect(stats.songCount).toBe(2);
    expect(stats.totalDurationSec).toBe(200 + 15 * 60 + 250);
  });

  it('treats a missing song lookup as zero duration rather than throwing', () => {
    const stats = getSetlistStats([buildSongItem('unknown-song')], songs);
    expect(stats.songCount).toBe(1);
    expect(stats.totalDurationSec).toBe(0);
  });
});
