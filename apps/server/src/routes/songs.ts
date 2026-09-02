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
  deleteVoice,
  detachVoiceFile,
  fileRefSchema,
  findSetlistsReferencingSong,
  removeSongFromAllSetlists,
  replaceVoiceFile,
  resolveIdeaTieInputSchema,
  resolveIdeaTie as resolveIdeaTieOnDoc,
} from '@bandstand/core';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { attachments, bandMembers, userPrefs } from '../db/schema/index';
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

  // songId is a Yjs map key, not a foreign key — nothing else verifies it
  // actually belongs to this band. Without this check, any band (a
  // throwaway one included — registration is open, and creating a band
  // makes you its owner) could probe an arbitrary songId for whether
  // *anyone on the instance* has personal notes for it, going straight to
  // withBandDoc's live doc (authoritative — see the DELETE handler below
  // for why the debounced snapshot isn't good enough here either) rather
  // than trusting the caller's own band membership to imply anything about
  // some other band's song.
  const result = await withBandDoc(bandId, (doc) => {
    if (!doc.getMap('songs').has(songId)) return { notFound: true } as const;
    return { notFound: false, affectedSetlists: findSetlistsReferencingSong(doc, songId) } as const;
  });
  if (result.notFound) return c.json({ error: 'Not found' }, 404);

  // Scoped to this band's own members: the notes to report on are those of
  // people who could actually have written them for *this band's* song,
  // not an instance-wide check for the raw songId.
  const { rows } = await db.execute<{ has_personal_notes: boolean }>(
    sql`select exists (
      select 1 from ${userPrefs}
      where ${userPrefs.songNotes} ? ${songId}
        and user_id in (select user_id from ${bandMembers} where band_id = ${bandId}::uuid)
    ) as has_personal_notes`,
  );

  return c.json({ affectedSetlists: result.affectedSetlists, hasPersonalNotes: rows[0]?.has_personal_notes ?? false });
});

songsRoute.delete('/:songId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const songId = c.req.param('songId');
  if (!bandId || !songId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'song:deleteForever')) return c.json({ error: 'Forbidden' }, 403);

  // songId is a Yjs map key, not a foreign key — nothing else verifies it
  // actually belongs to this band, and the mutations below are harmless
  // no-ops for an id this band's doc doesn't have. Without this check, any
  // band could DELETE an arbitrary songId (e.g. a former member's old
  // band, still known from an earlier repertoire export) and, via the
  // instance-wide user_prefs write further down, wipe every user's
  // personal notes for that song. Checked against the live doc inside this
  // same withBandDoc call — not the band_docs.snapshot column, which a
  // debounced store hook (2s) can lag behind a just-created song by — so
  // this gets authority for free instead of a second, possibly-stale read.
  const result = await withBandDoc(bandId, (doc) => {
    if (!doc.getMap('songs').has(songId)) return { notFound: true } as const;
    const names = removeSongFromAllSetlists(doc, songId);
    deleteSongForever(doc, songId);
    return { notFound: false, affectedSetlists: names } as const;
  });
  if (result.notFound) return c.json({ error: 'Not found' }, 404);

  // Every *band member's* personal notes/checklist for this song — not
  // instance-wide: user_prefs itself has no band column, but the notes
  // worth clearing are only ever those of people who could have written
  // them for this band's own song, i.e. this band's members. Postgres
  // rejects a table-qualified name as an UPDATE SET target ("set
  // user_prefs.song_notes = ..."), so the column is referenced bare here —
  // the jsonb `-` (remove key) operator has no drizzle query-builder
  // equivalent, hence the raw SQL at all.
  await db.execute(sql`
    update ${userPrefs} set song_notes = song_notes - ${songId}
    where user_id in (select user_id from ${bandMembers} where band_id = ${bandId}::uuid)
  `);

  return c.json({ affectedSetlists: result.affectedSetlists });
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

/** Removes a whole voice — chordpro or files-kind alike. */
songsRoute.delete('/:songId/voices/:voiceId', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  if (!bandId || !voiceId) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'voice:delete')) return c.json({ error: 'Forbidden' }, 403);

  await withBandDoc(bandId, (doc) => deleteVoice(doc, voiceId));

  return c.json({ ok: true });
});

/**
 * Swaps a `files` voice's existing file (identified by its current sha256)
 * for one that's already been uploaded to the band's content store — the
 * caller has already done presign-upload -> PUT -> confirm for the new
 * bytes (same as a normal new upload) before ever reaching this route; this
 * only rewrites which hash the voice itself points at.
 */
songsRoute.post('/:songId/voices/:voiceId/files/:sha256/overwrite', requireBandRole('member'), async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  const sha256 = c.req.param('sha256');
  if (!bandId || !voiceId || !sha256) return c.json({ error: 'Missing params' }, 400);
  if (!can(c.get('bandRole'), 'file:overwrite')) return c.json({ error: 'Forbidden' }, 403);

  const newFile = fileRefSchema.parse(await c.req.json());

  // The client is expected to have already confirmed a real upload for
  // newFile.sha256 (same presign -> PUT -> confirm flow as any new file) —
  // verify that actually happened rather than trusting the request body,
  // same reasoning as /files/confirm re-hashing instead of trusting the
  // client's own claim.
  const [existingAttachment] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.bandId, bandId), eq(attachments.sha256, newFile.sha256)));
  if (!existingAttachment) return c.json({ error: 'No confirmed upload found for that file' }, 400);

  await withBandDoc(bandId, (doc) => replaceVoiceFile(doc, voiceId, sha256, newFile));

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
