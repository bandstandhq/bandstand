// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import { songSchema } from '../schemas/song';
import { voiceSchema } from '../schemas/voice';
import { setlistSchema } from '../schemas/setlist';
import { setlistItemSchema } from '../schemas/setlistItem';
import { anchorSchema } from '../schemas/anchor';
import { availabilityAnswerSchema } from '../schemas/availabilityAnswer';
import { calendarEventSchema } from '../schemas/event';
import { pollSchema } from '../schemas/poll';

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
  // Keyed by songId. Absent entirely on any doc written before Milestone 2
  // Teil B — defaults to empty rather than requiring a migration, same as
  // `assignments` above. See docs/adr/0010-anchor-sync.md.
  anchors: z.record(z.string(), z.array(anchorSchema)).default({}),
  // Milestone 3 (docs/adr/0011-calendar-events.md) — all four flat, keyed
  // Y.Maps, absent entirely on any older doc, same `.default({})` pattern as
  // `assignments`/`anchors` above. No per-entity Y.Array is needed for any
  // of these (unlike `items`/`anchors`) since none of them are an ordered
  // list.
  events: z.record(z.string(), calendarEventSchema).default({}),
  // `<eventId>:<userId>` -> answer. For a virtual (non-exception) occurrence
  // of a recurring event, `eventId` here is the synthetic
  // `${templateEventId}@${isoDate}` id, not the template's own id — see the
  // ADR's "availability keys by concrete occurrence, not by series" section.
  availability: z.record(z.string(), availabilityAnswerSchema).default({}),
  polls: z.record(z.string(), pollSchema).default({}),
  // `<pollId>:<optionId>:<userId>` -> answer.
  pollVotes: z.record(z.string(), availabilityAnswerSchema).default({}),
});

export type BandSnapshot = z.infer<typeof bandSnapshotSchema>;

/** The `items:<setlistId>` Y.Array naming convention — shared with yjs/setlists.ts. */
export const itemsKey = (setlistId: string) => `items:${setlistId}`;

/** The `anchors:<songId>` Y.Array naming convention — shared with yjs/anchors.ts. */
export const anchorsKey = (songId: string) => `anchors:${songId}`;

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
  const events = doc.getMap('events').toJSON();
  const availability = doc.getMap('availability').toJSON();
  const polls = doc.getMap('polls').toJSON();
  const pollVotes = doc.getMap('pollVotes').toJSON();
  const rawSetlists = doc.getMap('setlists').toJSON() as Record<string, unknown>;

  const setlists: Record<string, unknown> = {};
  for (const [setlistId, setlist] of Object.entries(rawSetlists)) {
    setlists[setlistId] = {
      ...(setlist as object),
      items: doc.getArray(itemsKey(setlistId)).toJSON(),
    };
  }

  const anchors: Record<string, unknown> = {};
  for (const songId of Object.keys(songs)) {
    const songAnchors = doc.getArray(anchorsKey(songId)).toJSON();
    if (songAnchors.length > 0) anchors[songId] = songAnchors;
  }

  return bandSnapshotSchema.parse({ songs, voices, setlists, assignments, anchors, events, availability, polls, pollVotes });
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

  for (const [songId, songAnchors] of Object.entries(parsed.anchors)) {
    if (songAnchors.length > 0) doc.getArray(anchorsKey(songId)).push(songAnchors);
  }

  const eventsMap = doc.getMap('events');
  for (const [eventId, event] of Object.entries(parsed.events)) {
    eventsMap.set(eventId, event);
  }

  const availabilityMap = doc.getMap('availability');
  for (const [key, answer] of Object.entries(parsed.availability)) {
    availabilityMap.set(key, answer);
  }

  const pollsMap = doc.getMap('polls');
  for (const [pollId, poll] of Object.entries(parsed.polls)) {
    pollsMap.set(pollId, poll);
  }

  const pollVotesMap = doc.getMap('pollVotes');
  for (const [key, answer] of Object.entries(parsed.pollVotes)) {
    pollVotesMap.set(key, answer);
  }

  return doc;
}
