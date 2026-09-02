// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, exercised through the actual, fully composed app (see
// ../app.ts) — not a locally reassembled subset of routes. See
// docs/adr/0011-calendar-events.md.
import { randomUUID } from 'node:crypto';
import { createPoll, votePoll, yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `test-polls-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Polls Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

async function loadSnapshot(bandId: string) {
  const [row] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, bandId));
  return row!.snapshot as { availability?: Record<string, string> };
}

describe('POST /bands/:bandId/polls/:pollId/close (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it("carries the winning option's votes over as the new event's availability, but not the losing option's", async () => {
    const owner = await signUpTestUser();
    const winningVoter = await signUpTestUser();
    const losingVoter = await signUpTestUser();
    cleanupUserIds.push(owner.userId, winningVoter.userId, losingVoter.userId);

    const [band] = await db.insert(bands).values({ name: 'Polls Test Band', slug: `test-polls-${randomUUID()}` }).returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db.insert(bandMembers).values([
      { bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] },
      { bandId: band.id, userId: winningVoter.userId, role: 'member', instruments: [] },
      { bandId: band.id, userId: losingVoter.userId, role: 'member', instruments: [] },
    ]);

    const doc = new Y.Doc();
    const pollId = createPoll(doc, {
      title: 'Test Poll',
      options: [{ startsAt: Date.now() + 86_400_000 }, { startsAt: Date.now() + 172_800_000 }],
    });
    const poll = doc.getMap('polls').get(pollId) as { options: { id: string }[] };
    const [winningOption, losingOption] = poll.options;
    votePoll(doc, pollId, winningOption!.id, winningVoter.userId, 'yes');
    votePoll(doc, pollId, losingOption!.id, losingVoter.userId, 'no');

    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
      snapshot: yDocToSnapshot(doc),
    });

    const res = await app.request(`/bands/${band.id}/polls/${pollId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ optionId: winningOption!.id, title: 'Resolved Rehearsal', type: 'rehearsal' }),
    });
    expect(res.status).toBe(200);
    const { eventId } = (await res.json()) as { eventId: string };

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot.availability?.[`${eventId}:${winningVoter.userId}`]).toBe('yes');
    expect(snapshot.availability?.[`${eventId}:${losingVoter.userId}`]).toBeUndefined();
  });
});
