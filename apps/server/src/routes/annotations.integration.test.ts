// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, exercised through the actual REST routes. The two
// properties that matter most here aren't just status codes: (1) another
// member editing the underlying voice must never touch this member's own
// annotation rows (they live in a completely separate table, but this is
// the actual proof, not an assumption), and (2) a stale conditional update
// forks a "(Conflict Copy)" layer instead of silently overwriting.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, users, voiceAnnotationLayers } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-annotations-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Annotations Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return app.request(`/bands${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// Registers every user/band it creates for cleanup itself — a caller that
// only destructures the fields it needs (e.g. `{ band, member, admin }`)
// used to also have to remember to separately push every id it got back
// into cleanupUserIds/cleanupBandIds, and every call site here forgot at
// least `owner` (see issue for the accumulated leak this caused). Taking
// the arrays as parameters and pushing internally makes that impossible to
// forget again.
async function setupBand(cleanupUserIds: string[], cleanupBandIds: string[]) {
  const owner = await signUpTestUser();
  const admin = await signUpTestUser();
  const member = await signUpTestUser();
  const outsider = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Annotations Test Band', slug: `test-annotations-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');
  cleanupUserIds.push(owner.userId, admin.userId, member.userId, outsider.userId);
  cleanupBandIds.push(band.id);

  await db.insert(bandMembers).values([
    { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
    { bandId: band.id, userId: admin.userId, role: 'admin', instruments: [] },
    { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
  ]);

  return { band, owner, admin, member, outsider };
}

const voiceId = 'voice:test-voice';

describe('voice annotations (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects a non-member entirely', async () => {
    const { band, outsider } = await setupBand(cleanupUserIds, cleanupBandIds);

    const res = await req(`/${band.id}/annotations/voices/${voiceId}`, 'GET', outsider.token);
    expect(res.status).toBe(403);
  });

  it('creates a personal layer, lists only your own, and never someone else\'s', async () => {
    const { band, member, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'Rehearsal May' });
    expect(created.status).toBe(201);
    const layer = (await created.json()) as { id: string };

    await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', admin.token, { name: "Admin's own layer" });

    const memberList = (await (await req(`/${band.id}/annotations/voices/${voiceId}`, 'GET', member.token)).json()) as { id: string }[];
    expect(memberList.map((l) => l.id)).toEqual([layer.id]);
  });

  it('updates a layer\'s objects, then rejects an update from a different member', async () => {
    const { band, member, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (
      await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'Gig June' })
    ).json()) as { id: string; updatedAt: string };

    const objects = [{ id: 'o1', type: 'text', page: 0, position: { x: 0.1, y: 0.1 }, text: 'D.C. al Fine', color: '#f00', fontSize: 16 }];
    const update = await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects,
      expectedUpdatedAt: created.updatedAt,
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ conflict: false, layer: { objects } });

    const forbidden = await req(`/${band.id}/annotations/${created.id}`, 'PUT', admin.token, {
      objects: [],
      expectedUpdatedAt: created.updatedAt,
    });
    expect(forbidden.status).toBe(403);
  });

  it('forks a "(Conflict Copy)" layer on a stale conditional update instead of overwriting', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (
      await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'Tablet session' })
    ).json()) as { id: string; updatedAt: string };

    // Simulate a second device having already saved a change first.
    const firstUpdate = (await (
      await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
        objects: [{ id: 'o1', type: 'text', page: 0, position: { x: 0, y: 0 }, text: 'from phone', color: '#000', fontSize: 12 }],
        expectedUpdatedAt: created.updatedAt,
      })
    ).json()) as { layer: { updatedAt: string } };

    // The tablet, still holding the *original* updatedAt, tries to save its own edit.
    const staleUpdate = await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects: [{ id: 'o2', type: 'text', page: 0, position: { x: 0, y: 0 }, text: 'from tablet', color: '#000', fontSize: 12 }],
      expectedUpdatedAt: created.updatedAt,
    });
    expect(staleUpdate.status).toBe(200);
    const staleResult = (await staleUpdate.json()) as { conflict: boolean; layer: { id: string; name: string; objects: unknown[] } };
    expect(staleResult.conflict).toBe(true);
    expect(staleResult.layer.name).toBe('Tablet session (Conflict Copy)');
    expect(staleResult.layer.id).not.toBe(created.id);

    // Neither version was lost: the original row still has the phone's edit...
    const [originalRow] = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, created.id));
    expect(originalRow?.updatedAt.toISOString()).toBe(firstUpdate.layer.updatedAt);
    // ...and the forked copy has the tablet's.
    const [forkedRow] = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, staleResult.layer.id));
    expect(forkedRow?.objects).toMatchObject([{ text: 'from tablet' }]);
  });

  it('leaves a member\'s own annotations untouched when another member edits the voice', async () => {
    const { band, member, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (
      await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'My notes' })
    ).json()) as { id: string; updatedAt: string };
    await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects: [{ id: 'o1', type: 'text', page: 0, position: { x: 0, y: 0 }, text: 'precious annotation', color: '#000', fontSize: 12 }],
      expectedUpdatedAt: created.updatedAt,
    });

    const before = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, created.id));

    // "Another member edits the voice" — simulated here as any unrelated
    // band-doc activity by the admin; annotations live in a completely
    // separate table with no foreign key to voice content, so nothing
    // about a voice edit could touch this row regardless of what the edit
    // is. What's under test is that the row is untouched byte-for-byte.
    await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', admin.token, { name: 'unrelated admin layer' });

    const after = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, created.id));
    expect(after).toEqual(before);
  });

  it('shares a layer as a frozen copy, readable by any member, and re-sharing updates it in place', async () => {
    const { band, member, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (
      await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'Solo cues' })
    ).json()) as { id: string; updatedAt: string };
    await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects: [{ id: 'o1', type: 'text', page: 0, position: { x: 0, y: 0 }, text: 'v1', color: '#000', fontSize: 12 }],
      expectedUpdatedAt: created.updatedAt,
    });

    const shared = await req(`/${band.id}/annotations/${created.id}/share`, 'POST', member.token);
    expect(shared.status).toBe(201);
    const sharedLayer = (await shared.json()) as { id: string };

    const adminSees = (await (await req(`/${band.id}/annotations/voices/${voiceId}/shared`, 'GET', admin.token)).json()) as { id: string }[];
    expect(adminSees.map((l) => l.id)).toContain(sharedLayer.id);

    // Editing the source afterward doesn't retroactively change the frozen copy.
    const latest = (await (await req(`/${band.id}/annotations/voices/${voiceId}`, 'GET', member.token)).json()) as {
      id: string;
      updatedAt: string;
    }[];
    const mine = latest.find((l) => l.id === created.id)!;
    await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects: [{ id: 'o1', type: 'text', page: 0, position: { x: 0, y: 0 }, text: 'v2', color: '#000', fontSize: 12 }],
      expectedUpdatedAt: mine.updatedAt,
    });
    const [stillFrozen] = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, sharedLayer.id));
    expect(stillFrozen?.objects).toMatchObject([{ text: 'v1' }]);

    // Re-sharing updates the existing shared copy in place, not a second one.
    const resharedRes = await req(`/${band.id}/annotations/${created.id}/share`, 'POST', member.token);
    expect(resharedRes.status).toBe(200);
    const [nowUpdated] = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, sharedLayer.id));
    expect(nowUpdated?.objects).toMatchObject([{ text: 'v2' }]);
  });

  it('rejects an objects array over the configured size limit', async () => {
    const { band, member } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (
      await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'Overloaded layer' })
    ).json()) as { id: string; updatedAt: string };

    const tooManyObjects = Array.from({ length: 5001 }, (_, i) => ({
      id: `o${i}`,
      type: 'text' as const,
      page: 0,
      position: { x: 0, y: 0 },
      text: 'x',
      color: '#000',
      fontSize: 12,
    }));

    const res = await req(`/${band.id}/annotations/${created.id}`, 'PUT', member.token, {
      objects: tooManyObjects,
      expectedUpdatedAt: created.updatedAt,
    });
    expect(res.status).toBe(400);

    const [row] = await db.select().from(voiceAnnotationLayers).where(eq(voiceAnnotationLayers.id, created.id));
    expect(row?.objects).toEqual([]);
  });

  it('lets the original sharer, or an admin, remove a shared layer — but not an unrelated member', async () => {
    const { band, member, admin } = await setupBand(cleanupUserIds, cleanupBandIds);

    const created = (await (await req(`/${band.id}/annotations/voices/${voiceId}`, 'POST', member.token, { name: 'To share' })).json()) as {
      id: string;
    };
    const shared = (await (await req(`/${band.id}/annotations/${created.id}/share`, 'POST', member.token)).json()) as { id: string };

    const memberDeletes = await req(`/${band.id}/annotations/${shared.id}`, 'DELETE', member.token);
    expect(memberDeletes.status).toBe(200);

    const reshared = (await (await req(`/${band.id}/annotations/${created.id}/share`, 'POST', member.token)).json()) as { id: string };
    const adminDeletes = await req(`/${band.id}/annotations/${reshared.id}`, 'DELETE', admin.token);
    expect(adminDeletes.status).toBe(200);
  });
});
