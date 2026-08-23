// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Public-domain traditional songs, used as realistic ChordPro seed data —
// real chord/lyric content, not lorem ipsum, so Stage Mode and setlist work
// has something real to render against from the first `pnpm seed`.
import type { Song } from '@bandstand/core';

export interface SeedSong {
  song: Song;
  // ChordPro content for the song's one implicit voice — see
  // docs/adr/0004-parts-and-anchors.md for why this isn't on Song itself.
  body: string;
}

function song(partial: Omit<Song, 'bandNotes' | 'links' | 'votes'> & { body: string }): SeedSong {
  const { body, ...meta } = partial;
  return { song: { ...meta, bandNotes: '', links: [], votes: {} }, body };
}

export const seedSongs: Record<string, SeedSong> = {
  'song-amazing-grace': song({
    title: 'Amazing Grace',
    artist: 'Traditional',
    key: 'G',
    bpm: 72,
    durationSec: 240,
    status: 'active',
    body: [
      '{title: Amazing Grace}',
      '{key: G}',
      '{start_of_verse}',
      '[G]Amazing [G7]grace, how [C]sweet the [G]sound',
      'That [G]saved a [Em]wretch like [D]me',
      'I [G]once was [G7]lost, but [C]now am [G]found',
      'Was [G]blind but [D]now I [G]see',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-auld-lang-syne': song({
    title: 'Auld Lang Syne',
    artist: 'Traditional',
    key: 'G',
    bpm: 88,
    durationSec: 210,
    status: 'active',
    body: [
      '{title: Auld Lang Syne}',
      '{key: G}',
      '{start_of_verse}',
      'Should [G]auld ac[C]quaintance [G]be for[D]got',
      'And [G]never [Em]brought to [A]mind',
      '{end_of_verse}',
      '{start_of_chorus}',
      'For [G]auld lang [C]syne, my [G]dear',
      'For [Em]auld lang [D]syne',
      '{end_of_chorus}',
    ].join('\n'),
  }),
  'song-house-of-the-rising-sun': song({
    title: 'House of the Rising Sun',
    artist: 'Traditional',
    key: 'Am',
    bpm: 120,
    durationSec: 285,
    status: 'active',
    body: [
      '{title: House of the Rising Sun}',
      '{key: Am}',
      '{start_of_verse}',
      'There [Am]is a [C]house in [D]New Or[F]leans',
      'They [Am]call the [C]Rising [E]Sun',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-scarborough-fair': song({
    title: 'Scarborough Fair',
    artist: 'Traditional',
    key: 'Dm',
    bpm: 76,
    durationSec: 260,
    status: 'active',
    body: [
      '{title: Scarborough Fair}',
      '{key: Dm}',
      '{start_of_verse}',
      'Are you [Dm]going to [C]Scarbor[Dm]ough Fair',
      '[C]Parsley, [Dm]sage, rose[C]mary and [Dm]thyme',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-greensleeves': song({
    title: 'Greensleeves',
    artist: 'Traditional',
    key: 'Am',
    bpm: 84,
    durationSec: 230,
    status: 'active',
    body: [
      '{title: Greensleeves}',
      '{key: Am}',
      '{start_of_verse}',
      '[Am]Alas my [C]love you [D]do me [Em]wrong',
      'To [Am]cast me [G]off dis[Am]courteously',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-swing-low-sweet-chariot': song({
    title: 'Swing Low, Sweet Chariot',
    artist: 'Traditional',
    key: 'D',
    bpm: 68,
    durationSec: 220,
    status: 'active',
    body: [
      '{title: Swing Low, Sweet Chariot}',
      '{key: D}',
      '{start_of_chorus}',
      '[D]Swing low, sweet [G]chariot',
      '[D]Coming for to [A]carry me [D]home',
      '{end_of_chorus}',
    ].join('\n'),
  }),
  'song-when-the-saints': song({
    title: 'When the Saints Go Marching In',
    artist: 'Traditional',
    key: 'F',
    bpm: 116,
    durationSec: 200,
    status: 'active',
    body: [
      '{title: When the Saints Go Marching In}',
      '{key: F}',
      '{start_of_verse}',
      '[F]Oh when the [Bb]saints, [F]go marching [C]in',
      '[F]Oh when the [Bb]saints go [F]marching [C]in [F]',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-oh-susanna': song({
    title: 'Oh! Susanna',
    artist: 'Stephen Foster',
    key: 'C',
    bpm: 128,
    durationSec: 180,
    status: 'active',
    body: [
      '{title: Oh! Susanna}',
      '{key: C}',
      '{start_of_verse}',
      '[C]I come from Alabama with my [F]banjo on my [C]knee',
      "I'm [C]going to Louisiana my [G]true love for to [C]see",
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-home-on-the-range': song({
    title: 'Home on the Range',
    artist: 'Traditional',
    key: 'G',
    bpm: 92,
    durationSec: 250,
    status: 'idea',
    body: [
      '{title: Home on the Range}',
      '{key: G}',
      '{start_of_verse}',
      '[G]Oh, give me a [C]home where the [G]buffalo [D]roam',
      'Where the [G]deer and the [C]antelope [G]play',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-red-river-valley': song({
    title: 'Red River Valley',
    artist: 'Traditional',
    key: 'G',
    bpm: 80,
    durationSec: 215,
    status: 'idea',
    body: [
      '{title: Red River Valley}',
      '{key: G}',
      '{start_of_verse}',
      '[G]From this valley they [G7]say you are [C]going',
      'We will [G]miss your bright [D]eyes and sweet [G]smile',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-shenandoah': song({
    title: 'Shenandoah',
    artist: 'Traditional',
    key: 'D',
    bpm: 64,
    durationSec: 270,
    status: 'active',
    body: [
      '{title: Shenandoah}',
      '{key: D}',
      '{start_of_verse}',
      '[D]Oh Shenan[G]doah, I [D]long to [A]hear you',
      '[D]Away, you [G]rolling [D]river',
      '{end_of_verse}',
    ].join('\n'),
  }),
  'song-frere-jacques': song({
    title: 'Frère Jacques',
    artist: 'Traditional',
    key: 'C',
    bpm: 100,
    durationSec: 90,
    status: 'archived',
    body: [
      '{title: Frère Jacques}',
      '{key: C}',
      '{start_of_verse}',
      '[C]Frère Jacques, Frère Jacques',
      'Dormez [G]vous? Dormez [C]vous?',
      '{end_of_verse}',
    ].join('\n'),
  }),
};
