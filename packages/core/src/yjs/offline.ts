// SPDX-License-Identifier: Apache-2.0
//
// Which content-addressed blobs are worth pre-loading for offline use: every
// file referenced by any voice of any song in an "upcoming" setlist. Every
// voice, not just each member's own assignment — a last-minute reassignment
// shouldn't leave someone without their part just because the pre-load ran
// before they were switched to it.
import * as Y from 'yjs';
import { setlistSchema } from '../schemas/setlist';
import { setlistItemSchema } from '../schemas/setlistItem';
import { voiceSchema } from '../schemas/voice';
import { itemsKey } from './snapshot';

/** No date at all counts as upcoming — an undated setlist (e.g. a standing practice set) is exactly the kind of thing worth always having offline. */
export function isUpcomingSetlist(eventDate: string | undefined, today: Date): boolean {
  if (!eventDate) return true;
  return eventDate >= today.toISOString().slice(0, 10);
}

export function collectUpcomingFileHashes(doc: Y.Doc, today: Date = new Date()): string[] {
  const songIds = new Set<string>();

  doc.getMap('setlists').forEach((raw, setlistId) => {
    const setlist = setlistSchema.parse(raw);
    if (!isUpcomingSetlist(setlist.eventDate, today)) return;

    for (const rawItem of doc.getArray(itemsKey(setlistId)).toJSON()) {
      const item = setlistItemSchema.parse(rawItem);
      if (item.type === 'song') songIds.add(item.songId);
    }
  });

  const hashes = new Set<string>();
  doc.getMap('voices').forEach((raw) => {
    const voice = voiceSchema.parse(raw);
    if (voice.kind !== 'files' || !songIds.has(voice.songId)) return;
    for (const file of voice.files) hashes.add(file.sha256);
  });

  return [...hashes];
}
