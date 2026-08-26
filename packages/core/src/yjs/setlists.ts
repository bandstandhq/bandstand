// SPDX-License-Identifier: Apache-2.0
//
// Pure Y.Doc mutations/reads for the `setlists` map and its per-setlist
// `items:<setlistId>` Y.Array — no React, no server, testable with a plain
// in-memory Y.Doc. UI code calls these instead of touching
// doc.getMap('setlists')/doc.getArray(...) directly.
import * as Y from 'yjs';
import type { Song } from '../schemas/song';
import { type Setlist, setlistSchema } from '../schemas/setlist';
import { type SetlistItem, setlistItemSchema } from '../schemas/setlistItem';
import { itemsKey } from './snapshot';

function getSetlistMapOrThrow(doc: Y.Doc, setlistId: string): Setlist {
  const existing = doc.getMap('setlists').get(setlistId) as Setlist | undefined;
  if (!existing) throw new Error(`Setlist not found: ${setlistId}`);
  return existing;
}

export function createSetlist(doc: Y.Doc, name: string, eventDate?: string): string {
  const setlistId = crypto.randomUUID();
  const setlist = setlistSchema.parse({ name, eventDate, updatedAt: Date.now() });
  doc.getMap('setlists').set(setlistId, setlist);
  return setlistId;
}

export function renameSetlist(doc: Y.Doc, setlistId: string, name: string): void {
  const existing = getSetlistMapOrThrow(doc, setlistId);
  doc.getMap('setlists').set(setlistId, setlistSchema.parse({ ...existing, name, updatedAt: Date.now() }));
}

/** Copies a setlist's name and item order into a new setlist; drops the event date. */
export function duplicateSetlist(doc: Y.Doc, setlistId: string): string {
  const existing = getSetlistMapOrThrow(doc, setlistId);
  const items = doc.getArray(itemsKey(setlistId)).toJSON() as SetlistItem[];

  const newSetlistId = crypto.randomUUID();
  doc.getMap('setlists').set(newSetlistId, setlistSchema.parse({ name: existing.name, updatedAt: Date.now() }));
  const copiedItems = items.map((item) => setlistItemSchema.parse({ ...item, id: crypto.randomUUID() }));
  doc.getArray(itemsKey(newSetlistId)).push(copiedItems);

  return newSetlistId;
}

export function deleteSetlist(doc: Y.Doc, setlistId: string): void {
  doc.getMap('setlists').delete(setlistId);
  const items = doc.getArray(itemsKey(setlistId));
  if (items.length > 0) items.delete(0, items.length);
}

function findSongItemIndexes(doc: Y.Doc, setlistId: string, songId: string): number[] {
  return doc
    .getArray(itemsKey(setlistId))
    .toArray()
    .map((item, index) => ({ item: item as SetlistItem, index }))
    .filter(({ item }) => item.type === 'song' && item.songId === songId)
    .map(({ index }) => index);
}

/**
 * Read-only: the names of setlists that reference `songId` in at least one
 * item — for a delete-confirmation dialog to name before anything is
 * actually removed.
 */
export function findSetlistsReferencingSong(doc: Y.Doc, songId: string): string[] {
  const setlists = doc.getMap('setlists');
  const names: string[] = [];
  for (const setlistId of setlists.keys()) {
    if (findSongItemIndexes(doc, setlistId, songId).length > 0) {
      names.push((setlists.get(setlistId) as Setlist).name);
    }
  }
  return names;
}

/**
 * Removes every song-item referencing `songId` from every setlist's items
 * array — called before permanently deleting a song, so no setlist is left
 * pointing at one that no longer exists. Returns the names of setlists that
 * actually had such an item, so a delete-confirmation flow can name them.
 */
export function removeSongFromAllSetlists(doc: Y.Doc, songId: string): string[] {
  const affectedNames: string[] = [];
  const setlists = doc.getMap('setlists');

  for (const setlistId of setlists.keys()) {
    const indexesToRemove = findSongItemIndexes(doc, setlistId, songId);
    if (indexesToRemove.length === 0) continue;

    doc.transact(() => {
      const items = doc.getArray(itemsKey(setlistId));
      // Highest index first, so removing one doesn't shift the rest.
      for (const index of [...indexesToRemove].reverse()) {
        items.delete(index, 1);
      }
    });

    affectedNames.push((setlists.get(setlistId) as Setlist).name);
  }

  return affectedNames;
}

export function buildSongItem(songId: string, overrideKey?: string): SetlistItem {
  return setlistItemSchema.parse({ id: crypto.randomUUID(), type: 'song', songId, overrideKey });
}

export function buildBreakItem(breakMinutes: number): SetlistItem {
  return setlistItemSchema.parse({ id: crypto.randomUUID(), type: 'break', breakMinutes });
}

export function buildFinaleItem(): SetlistItem {
  return setlistItemSchema.parse({ id: crypto.randomUUID(), type: 'finale' });
}

export function addSetlistItem(doc: Y.Doc, setlistId: string, item: SetlistItem): void {
  doc.getArray(itemsKey(setlistId)).push([item]);
}

/**
 * Like `addSetlistItem`, but inserts at a specific position instead of
 * always appending — for dragging a song from the repertoire pool onto a
 * specific spot in the setlist, where "always lands at the end regardless
 * of where you drop it" would be a bug, not a simplification.
 * `atIndex` is clamped to the current length, so a stale index (e.g. a
 * concurrent edit shrank the list between drag-start and drop) still
 * inserts somewhere valid rather than throwing.
 */
export function insertSetlistItem(doc: Y.Doc, setlistId: string, item: SetlistItem, atIndex: number): void {
  const items = doc.getArray(itemsKey(setlistId));
  const clampedIndex = Math.max(0, Math.min(atIndex, items.length));
  items.insert(clampedIndex, [item]);
}

export function removeSetlistItem(doc: Y.Doc, setlistId: string, itemId: string): void {
  const items = doc.getArray(itemsKey(setlistId));
  const index = items.toArray().findIndex((item) => (item as SetlistItem).id === itemId);
  if (index === -1) return;
  items.delete(index, 1);
}

/**
 * Moves an item to `toIndex` within the same setlist — delete+reinsert
 * wrapped in a transaction, the standard Yjs pattern for reordering (no
 * native "move" op on Y.Array). Concurrent reorders from other clients
 * still merge without losing items; the exact resulting order under a
 * true concurrent conflict is CRDT-resolved, not guaranteed to match
 * either client's intent exactly, which is expected/acceptable here.
 */
export function moveSetlistItem(doc: Y.Doc, setlistId: string, itemId: string, toIndex: number): void {
  const items = doc.getArray(itemsKey(setlistId));
  doc.transact(() => {
    const current = items.toArray();
    const fromIndex = current.findIndex((item) => (item as SetlistItem).id === itemId);
    if (fromIndex === -1 || fromIndex === toIndex) return;

    const [item] = current.splice(fromIndex, 1);
    items.delete(fromIndex, 1);
    const clampedToIndex = Math.max(0, Math.min(toIndex, items.length));
    items.insert(clampedToIndex, [item]);
  });
}

export interface SetlistStats {
  songCount: number;
  totalDurationSec: number;
}

/** Pure — doesn't touch the doc. `songs` is the band's songs map for duration lookups. */
export function getSetlistStats(items: SetlistItem[], songs: Record<string, Song>): SetlistStats {
  let songCount = 0;
  let totalDurationSec = 0;

  for (const item of items) {
    if (item.type === 'song') {
      songCount += 1;
      totalDurationSec += songs[item.songId]?.durationSec ?? 0;
    } else if (item.type === 'break') {
      totalDurationSec += item.breakMinutes * 60;
    }
  }

  return { songCount, totalDurationSec };
}
