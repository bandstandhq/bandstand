// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Strictly personal voice annotations — Postgres + a local cache, never the
// band's Yjs document (see packages/core/src/schemas/annotation.ts and B4
// of the Milestone 2 Teil B plan). REST, not CRDT: this is single-owner,
// non-collaborative data, so there's no merge story to build beyond the
// conditional-update conflict-copy fork below.
import { can, createAnnotationLayerInputSchema, updateAnnotationLayerInputSchema } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { voiceAnnotationLayers } from '../db/schema/index';
import type { BandVariables } from '../lib/bandAuthz';
import { requireBandRole } from '../lib/bandAuthz';

export const annotationsRoute = new Hono<{ Variables: BandVariables }>();

annotationsRoute.use('*', requireBandRole('member'));

function toLayerDto(row: typeof voiceAnnotationLayers.$inferSelect) {
  return {
    id: row.id,
    voiceId: row.voiceId,
    name: row.name,
    objects: row.objects,
    shared: row.shared,
    sourceLayerId: row.sourceLayerId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** This member's own layers for a voice — never another member's personal ones. */
annotationsRoute.get('/voices/:voiceId', async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  if (!bandId || !voiceId) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');

  const rows = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(and(eq(voiceAnnotationLayers.bandId, bandId), eq(voiceAnnotationLayers.voiceId, voiceId), eq(voiceAnnotationLayers.userId, userId)));

  return c.json(rows.map(toLayerDto));
});

/** Any band member may read what's been explicitly shared for a voice. */
annotationsRoute.get('/voices/:voiceId/shared', async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  if (!bandId || !voiceId) return c.json({ error: 'Missing params' }, 400);

  const rows = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(
      and(
        eq(voiceAnnotationLayers.bandId, bandId),
        eq(voiceAnnotationLayers.voiceId, voiceId),
        eq(voiceAnnotationLayers.shared, true),
      ),
    );

  return c.json(rows.map(toLayerDto));
});

annotationsRoute.post('/voices/:voiceId', async (c) => {
  const bandId = c.req.param('bandId');
  const voiceId = c.req.param('voiceId');
  if (!bandId || !voiceId) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');
  const { name } = createAnnotationLayerInputSchema.parse(await c.req.json());

  const [created] = await db
    .insert(voiceAnnotationLayers)
    .values({ bandId, voiceId, userId, name, objects: [] })
    .returning();

  return c.json(toLayerDto(created!), 201);
});

/**
 * Conditional update: applies only if `expectedUpdatedAt` still matches the
 * stored row. A mismatch means someone/something else (another of this same
 * member's devices) changed it first — rather than overwrite, fork the
 * client's version into a new "(Konfliktkopie)" layer and tell the caller,
 * so neither version is silently lost.
 */
annotationsRoute.put('/:layerId', async (c) => {
  const bandId = c.req.param('bandId');
  const layerId = c.req.param('layerId');
  if (!bandId || !layerId) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');
  const { objects, expectedUpdatedAt } = updateAnnotationLayerInputSchema.parse(await c.req.json());

  const [existing] = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(and(eq(voiceAnnotationLayers.id, layerId), eq(voiceAnnotationLayers.bandId, bandId)));
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.userId !== userId) return c.json({ error: 'Forbidden' }, 403);

  const [updated] = await db
    .update(voiceAnnotationLayers)
    .set({ objects, updatedAt: new Date() })
    .where(and(eq(voiceAnnotationLayers.id, layerId), eq(voiceAnnotationLayers.updatedAt, new Date(expectedUpdatedAt))))
    .returning();

  if (updated) return c.json({ conflict: false, layer: toLayerDto(updated) });

  const [forked] = await db
    .insert(voiceAnnotationLayers)
    .values({
      bandId,
      voiceId: existing.voiceId,
      userId,
      name: `${existing.name} (Konfliktkopie)`,
      objects,
    })
    .returning();
  return c.json({ conflict: true, layer: toLayerDto(forked!) });
});

/**
 * A personal layer: only its own owner may delete it. A shared layer: the
 * member who originally shared it (via `sourceLayerId`'s owning user), or
 * an admin/owner (`annotation:moderateShared`) — see docs/PERMISSIONS.md.
 */
annotationsRoute.delete('/:layerId', async (c) => {
  const bandId = c.req.param('bandId');
  const layerId = c.req.param('layerId');
  if (!bandId || !layerId) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');

  const [existing] = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(and(eq(voiceAnnotationLayers.id, layerId), eq(voiceAnnotationLayers.bandId, bandId)));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  if (!existing.shared) {
    if (existing.userId !== userId) return c.json({ error: 'Forbidden' }, 403);
  } else {
    const sharerOwnsIt = existing.sourceLayerId
      ? (
          await db
            .select({ userId: voiceAnnotationLayers.userId })
            .from(voiceAnnotationLayers)
            .where(eq(voiceAnnotationLayers.id, existing.sourceLayerId))
        )[0]?.userId === userId
      : false;
    if (!sharerOwnsIt && !can(c.get('bandRole'), 'annotation:moderateShared')) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  await db.delete(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, layerId));
  return c.json({ ok: true });
});

/**
 * A copy, not a link (see the plan's design decisions) — re-sharing after
 * further edits updates the existing shared copy in place rather than
 * creating a second one.
 */
annotationsRoute.post('/:layerId/share', async (c) => {
  const bandId = c.req.param('bandId');
  const layerId = c.req.param('layerId');
  if (!bandId || !layerId) return c.json({ error: 'Missing params' }, 400);
  const userId = c.get('userId');

  const [source] = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(and(eq(voiceAnnotationLayers.id, layerId), eq(voiceAnnotationLayers.bandId, bandId)));
  if (!source) return c.json({ error: 'Not found' }, 404);
  if (source.userId !== userId) return c.json({ error: 'Forbidden' }, 403);
  if (source.shared) return c.json({ error: 'A shared layer cannot itself be shared' }, 400);

  const [existingShared] = await db
    .select()
    .from(voiceAnnotationLayers)
    .where(and(eq(voiceAnnotationLayers.bandId, bandId), eq(voiceAnnotationLayers.sourceLayerId, layerId)));

  if (existingShared) {
    const [updated] = await db
      .update(voiceAnnotationLayers)
      .set({ name: source.name, objects: source.objects, updatedAt: new Date() })
      .where(eq(voiceAnnotationLayers.id, existingShared.id))
      .returning();
    return c.json(toLayerDto(updated!));
  }

  const [created] = await db
    .insert(voiceAnnotationLayers)
    .values({
      bandId,
      voiceId: source.voiceId,
      userId: null,
      name: source.name,
      objects: source.objects,
      shared: true,
      sourceLayerId: layerId,
    })
    .returning();
  return c.json(toLayerDto(created!), 201);
});
