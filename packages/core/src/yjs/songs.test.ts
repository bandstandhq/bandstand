// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { getDefaultVoiceId } from '../schemas/voice';
import {
  addSong,
  archiveSong,
  castVote,
  deleteSongForever,
  getIdeaVoteTally,
  resolveIdeaTie,
  restoreSong,
  setSongStatus,
  updateSong,
} from './songs';

function songInput(overrides: Partial<Parameters<typeof addSong>[1]> = {}) {
  return {
    title: 'Wonderwall',
    artist: 'Oasis',
    key: 'F#m',
    bpm: 87,
    durationSec: 258,
    status: 'idea' as const,
    body: '{title: Wonderwall}',
    ...overrides,
  };
}

describe('addSong', () => {
  it('creates the song and its default voice together', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput());

    const song = doc.getMap('songs').get(songId) as Record<string, unknown>;
    expect(song.title).toBe('Wonderwall');
    expect(song.bandNotes).toBe('');
    expect(song.links).toEqual([]);
    expect(song.votes).toEqual({});

    const voice = doc.getMap('voices').get(getDefaultVoiceId(songId)) as Record<string, unknown>;
    expect(voice).toEqual({ songId, name: 'Default', kind: 'chordpro', body: '{title: Wonderwall}' });
  });

  it('rejects an invalid song (e.g. bad key)', () => {
    const doc = new Y.Doc();
    expect(() => addSong(doc, songInput({ key: 'not-a-key' }))).toThrow();
  });
});

describe('updateSong', () => {
  it('patches metadata without touching status or votes', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'active' }));
    castVote(doc, songId, 'user-1', 'up');

    updateSong(doc, songId, { title: 'Wonderwall (Live)', bpm: 90 });

    const song = doc.getMap('songs').get(songId) as Record<string, unknown>;
    expect(song.title).toBe('Wonderwall (Live)');
    expect(song.bpm).toBe(90);
    expect(song.status).toBe('active');
    expect(song.votes).toEqual({ 'user-1': 'up' });
  });

  it('throws for a nonexistent song', () => {
    const doc = new Y.Doc();
    expect(() => updateSong(doc, 'missing', { title: 'x' })).toThrow('Song not found');
  });
});

describe('setSongStatus / archiveSong / restoreSong', () => {
  it('archiveSong sets status to archived', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'active' }));
    archiveSong(doc, songId);
    expect((doc.getMap('songs').get(songId) as { status: string }).status).toBe('archived');
  });

  it('restoreSong defaults to active', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'archived' }));
    restoreSong(doc, songId);
    expect((doc.getMap('songs').get(songId) as { status: string }).status).toBe('active');
  });

  it('restoreSong can target idea explicitly', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'archived' }));
    restoreSong(doc, songId, 'idea');
    expect((doc.getMap('songs').get(songId) as { status: string }).status).toBe('idea');
  });

  it('setSongStatus rejects an invalid status', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput());
    // @ts-expect-error deliberately invalid for the test
    expect(() => setSongStatus(doc, songId, 'deleted')).toThrow();
  });
});

describe('deleteSongForever', () => {
  it('removes both the song and its default voice', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput());

    deleteSongForever(doc, songId);

    expect(doc.getMap('songs').has(songId)).toBe(false);
    expect(doc.getMap('voices').has(getDefaultVoiceId(songId))).toBe(false);
  });
});

describe('resolveIdeaTie', () => {
  it('promotes a tied idea to active', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'idea' }));
    resolveIdeaTie(doc, songId, 'active');
    expect((doc.getMap('songs').get(songId) as { status: string }).status).toBe('active');
  });

  it('archives a tied idea instead', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput({ status: 'idea' }));
    resolveIdeaTie(doc, songId, 'archived');
    expect((doc.getMap('songs').get(songId) as { status: string }).status).toBe('archived');
  });
});

describe('castVote', () => {
  it('records and overwrites a single user vote', () => {
    const doc = new Y.Doc();
    const songId = addSong(doc, songInput());

    castVote(doc, songId, 'user-1', 'up');
    expect((doc.getMap('songs').get(songId) as { votes: object }).votes).toEqual({ 'user-1': 'up' });

    castVote(doc, songId, 'user-1', 'down');
    expect((doc.getMap('songs').get(songId) as { votes: object }).votes).toEqual({ 'user-1': 'down' });
  });
});

describe('getIdeaVoteTally', () => {
  it('reports null majority until everyone has voted', () => {
    const tally = getIdeaVoteTally({ votes: { u1: 'up' } }, 3);
    expect(tally).toEqual({ upCount: 1, downCount: 0, totalVotes: 1, allMembersVoted: false, majority: null });
  });

  it('reports an up majority once everyone has voted', () => {
    const tally = getIdeaVoteTally({ votes: { u1: 'up', u2: 'up', u3: 'down' } }, 3);
    expect(tally.allMembersVoted).toBe(true);
    expect(tally.majority).toBe('up');
  });

  it('reports a down majority', () => {
    const tally = getIdeaVoteTally({ votes: { u1: 'down', u2: 'down', u3: 'up' } }, 3);
    expect(tally.majority).toBe('down');
  });

  it('reports a tie, needing admin resolution', () => {
    const tally = getIdeaVoteTally({ votes: { u1: 'up', u2: 'down' } }, 2);
    expect(tally.majority).toBe('tie');
  });

  it('treats zero total members as never fully voted', () => {
    const tally = getIdeaVoteTally({ votes: {} }, 0);
    expect(tally.allMembersVoted).toBe(false);
    expect(tally.majority).toBeNull();
  });
});
