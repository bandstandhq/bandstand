// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import { songSchema } from '../schemas/song';
import { voiceSchema } from '../schemas/voice';
import { setlistSchema } from '../schemas/setlist';
import { setlistItemSchema } from '../schemas/setlistItem';

// Plain-object projection of a band's Yjs document. This is what gets
// written to Postgres's band_docs.snapshot (jsonb) on every Hocuspocus
// store, and is exactly what full-text search / PDF export / public links
// read from — never the source of truth (the Yjs doc is).
export const bandSnapshotSchema = z.object({
  songs: z.record(z.string(), songSchema),
  voices: z.record(z.string(), voiceSchema),
  setlists: z.record(z.string(), setlistSchema.extend({ items: z.array(setlistItemSchema) })),
  // `<songId>:<userId>` -> voiceId. Absent entirely on any doc written
  // before Milestone 2 — defaults to empty rather than requiring a migration.
  assignments: z.record(z.string(), z.string()).default({}),
});

export type BandSnapshot = z.infer<typeof bandSnapshotSchema>;

/** The `items:<setlistId>` Y.Array naming convention — shared with yjs/setlists.ts. */
export const itemsKey = (setlistId: string) => `items:${setlistId}`;

/**
 * Reads the documented per-band Yjs shape (`songs` Y.Map, `setlists` Y.Map,
 * one `items:<setlistId>` Y.Array per setlist) into a validated plain object.
 * Throws if the doc's contents don't match the schema — this is the guard
 * that keeps a corrupt/partial doc from ever reaching band_docs.snapshot.
 */
export function yDocToSnapshot(doc: Y.Doc): BandSnapshot {
  const songs = doc.getMap('songs').toJSON();
  const voices = doc.getMap('voices').toJSON();
  const assignments = doc.getMap('assignments').toJSON();
  const rawSetlists = doc.getMap('setlists').toJSON() as Record<string, unknown>;

  const setlists: Record<string, unknown> = {};
  for (const [setlistId, setlist] of Object.entries(rawSetlists)) {
    setlists[setlistId] = {
      ...(setlist as object),
      items: doc.getArray(itemsKey(setlistId)).toJSON(),
    };
  }

  return bandSnapshotSchema.parse({ songs, voices, setlists, assignments });
}

/**
 * Builds a Y.Doc matching the documented shape from a plain snapshot object.
 * Used by tests as a fixture builder — order within each setlist's Y.Array
 * follows the `items` array order given here.
 */
export function snapshotToYDoc(snapshot: BandSnapshot): Y.Doc {
  const parsed = bandSnapshotSchema.parse(snapshot);
  const doc = new Y.Doc();

  const songsMap = doc.getMap('songs');
  for (const [songId, song] of Object.entries(parsed.songs)) {
    songsMap.set(songId, song);
  }

  const voicesMap = doc.getMap('voices');
  for (const [voiceId, voice] of Object.entries(parsed.voices)) {
    voicesMap.set(voiceId, voice);
  }

  const assignmentsMap = doc.getMap('assignments');
  for (const [key, voiceId] of Object.entries(parsed.assignments)) {
    assignmentsMap.set(key, voiceId);
  }

  const setlistsMap = doc.getMap('setlists');
  for (const [setlistId, { items, ...setlist }] of Object.entries(parsed.setlists)) {
    setlistsMap.set(setlistId, setlist);
    doc.getArray(itemsKey(setlistId)).push(items);
  }

  return doc;
}
