// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Destructive song actions apply to the shared band Yjs document, so they
// go through withBandDoc (a real server-side write via
// Hocuspocus.openDirectConnection) rather than a client's own CRDT write —
// see docs/adr/0005-permissions.md. requireBandRole('member') is the
// baseline membership gate every band-scoped route uses; the actual
// authorization decision is the inline `can()` check against the one
// permissions matrix in @bandstand/core.
import {
  can,
  deleteSongForever,
  detachVoiceFile,
  findSetlistsReferencingSong,
  removeSongFromAllSetlists,
  resolveIdeaTieInputSchema,
  resolveIdeaTie as resolveIdeaTieOnDoc,
} from '@bandstand/core';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { userPrefs } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';
import { withBandDoc } from '../lib/bandDoc';

export const songsRoute = new Hono<{ Variables: BandVariables }>();

/** Read-only preview for the delete-confirmation dialog — no mutation. */
songsRoute.get('/:songId/delete-impact', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const songId = c.req.param('songId');
  if (!bandId || !songId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'song:deleteForever')) return c.json({ error: 'Forbidden' }, 403);

  const affectedSetlists = await withBandDoc(bandId, (doc) => findSetlistsReferencingSong(doc, songId));

  const { rows } = await db.execute<{ has_personal_notes: boolean }>(
    sql`select exists (select 1 from ${userPrefs} where ${userPrefs.songNotes} ? ${songId}) as has_personal_notes`,
  );

  return c.json({ affectedSetlists, hasPersonalNotes: rows[0]?.has_personal_notes ?? false });
});

songsRoute.delete('/:songId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const songId = c.req.param('songId');
  if (!bandId || !songId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'song:deleteForever')) return c.json({ error: 'Forbidden' }, 403);

  const affectedSetlists = await withBandDoc(bandId, (doc) => {
    const names = removeSongFromAllSetlists(doc, songId);
    deleteSongForever(doc, songId);
    return names;
  });

  // Every member's personal notes/checklist for this song, across the whole
  // instance — not band-scoped, since user_prefs isn't either (it's keyed
  // by songId alone, per user).
  // Postgres rejects a table-qualified name as an UPDATE SET target
  // ("set user_prefs.song_notes = ..."), so the column is referenced bare
  // here — the jsonb `-` (remove key) operator has no drizzle query-builder
  // equivalent, hence the raw SQL at all.
  await db.execute(sql`update ${userPrefs} set song_notes = song_notes - ${songId}`);

  return c.json({ affectedSetlists });
});

songsRoute.delete('/:songId/voices/:voiceId/files/:sha256', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  const sha256 = c.req.param('sha256');
  if (!bandId || !voiceId || !sha256) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'file:detach')) return c.json({ error: 'Forbidden' }, 403);

  await withBandDoc(bandId, (doc) => detachVoiceFile(doc, voiceId, sha256));

  return c.json({ ok: true });
});

songsRoute.post('/:songId/resolve-tie', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const songId = c.req.param('songId');
  if (!bandId || !songId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'idea:resolveTie')) return c.json({ error: 'Forbidden' }, 403);

  const body = resolveIdeaTieInputSchema.parse(await c.req.json());
  await withBandDoc(bandId, (doc) => resolveIdeaTieOnDoc(doc, songId, body.resolution));

  return c.json({ resolution: body.resolution });
});
