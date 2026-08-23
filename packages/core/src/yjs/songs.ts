// SPDX-License-Identifier: Apache-2.0
//
// Pure Y.Doc mutations/reads for the `songs`/`voices` maps — no React, no
// server, testable with a plain in-memory Y.Doc. UI code calls these
// instead of touching doc.getMap('songs') directly.
import * as Y from 'yjs';
import { getDefaultVoiceId, voiceSchema } from '../schemas/voice';
import { type Song, type SongStatus, type Vote, songSchema } from '../schemas/song';

export interface AddSongInput {
  title: string;
  artist: string;
  key: string;
  bpm: number;
  durationSec: number;
  status: SongStatus;
  bandNotes?: string;
  links?: string[];
  body: string; // ChordPro content for the song's one (default) voice
}

/** Creates a song and its default voice together; returns the new songId. */
export function addSong(doc: Y.Doc, input: AddSongInput): string {
  const songId = crypto.randomUUID();
  const song = songSchema.parse({
    title: input.title,
    artist: input.artist,
    key: input.key,
    bpm: input.bpm,
    durationSec: input.durationSec,
    status: input.status,
    bandNotes: input.bandNotes ?? '',
    links: input.links ?? [],
    votes: {},
  });
  doc.getMap('songs').set(songId, song);

  const voice = voiceSchema.parse({ songId, name: 'Default', body: input.body });
  doc.getMap('voices').set(getDefaultVoiceId(songId), voice);

  return songId;
}

export type SongPatch = Partial<Pick<Song, 'title' | 'artist' | 'key' | 'bpm' | 'durationSec' | 'bandNotes' | 'links'>>;

function getSongOrThrow(doc: Y.Doc, songId: string): Song {
  const existing = doc.getMap('songs').get(songId) as Song | undefined;
  if (!existing) throw new Error(`Song not found: ${songId}`);
  return existing;
}

/** Metadata-only update — status changes go through setSongStatus, votes through castVote. */
export function updateSong(doc: Y.Doc, songId: string, patch: SongPatch): void {
  const existing = getSongOrThrow(doc, songId);
  const updated = songSchema.parse({ ...existing, ...patch });
  doc.getMap('songs').set(songId, updated);
}

export function setSongStatus(doc: Y.Doc, songId: string, status: SongStatus): void {
  const existing = getSongOrThrow(doc, songId);
  doc.getMap('songs').set(songId, songSchema.parse({ ...existing, status }));
}

export function archiveSong(doc: Y.Doc, songId: string): void {
  setSongStatus(doc, songId, 'archived');
}

/** Un-archives a song back to 'idea' or 'active' (default: 'active'). */
export function restoreSong(doc: Y.Doc, songId: string, status: Extract<SongStatus, 'idea' | 'active'> = 'active'): void {
  setSongStatus(doc, songId, status);
}

export function castVote(doc: Y.Doc, songId: string, userId: string, vote: Vote): void {
  const existing = getSongOrThrow(doc, songId);
  const updated = songSchema.parse({ ...existing, votes: { ...existing.votes, [userId]: vote } });
  doc.getMap('songs').set(songId, updated);
}

export interface IdeaVoteTally {
  upCount: number;
  downCount: number;
  totalVotes: number;
  /** True once at least `totalMembers` votes are in — the trigger for "everyone has voted". */
  allMembersVoted: boolean;
  /** null until everyone has voted; 'tie' needs an admin to resolve manually. */
  majority: 'up' | 'down' | 'tie' | null;
}

/**
 * Pure derived state for the idea-voting UI — doesn't touch the doc.
 * `totalMembers` comes from the REST band-members list (not part of the
 * Yjs doc), so it's a parameter, not something read here.
 */
export function getIdeaVoteTally(song: Pick<Song, 'votes'>, totalMembers: number): IdeaVoteTally {
  const votes = Object.values(song.votes);
  const upCount = votes.filter((v) => v === 'up').length;
  const downCount = votes.filter((v) => v === 'down').length;
  const allMembersVoted = totalMembers > 0 && votes.length >= totalMembers;

  let majority: IdeaVoteTally['majority'] = null;
  if (allMembersVoted) {
    majority = upCount === downCount ? 'tie' : upCount > downCount ? 'up' : 'down';
  }

  return { upCount, downCount, totalVotes: votes.length, allMembersVoted, majority };
}
