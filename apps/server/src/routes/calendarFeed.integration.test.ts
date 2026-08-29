// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres, exercised through the actual, fully composed app (see
// ../app.ts) — not a locally reassembled subset of routes, which would
// drift from index.ts's real mounting/middleware without anyone noticing.
// See docs/adr/0011-calendar-events.md.
import { randomUUID } from 'node:crypto';
import { yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `ics-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'ICS Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function authedReq(path: string, method: string, token: string) {
  return app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
}

describe('ICS token routes (integration)', () => {
  const cleanupUserIds: string[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('lazily provisions a token on first GET, then returns the same one on a second GET', async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);

    const first = await authedReq('/me/ics-token', 'GET', member.token);
    expect(first.status).toBe(200);
    const { token: firstToken } = (await first.json()) as { token: string };
    expect(firstToken).toMatch(/^[0-9a-f]{64}$/);

    const second = await authedReq('/me/ics-token', 'GET', member.token);
    const { token: secondToken } = (await second.json()) as { token: string };
    expect(secondToken).toBe(firstToken);
  });

  it('regenerating issues a different token, immediately invalidating the old one', async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);

    const initial = await authedReq('/me/ics-token', 'GET', member.token);
    const { token: oldToken } = (await initial.json()) as { token: string };

    const regenerated = await authedReq('/me/ics-token/regenerate', 'POST', member.token);
    expect(regenerated.status).toBe(200);
    const { token: newToken } = (await regenerated.json()) as { token: string };
    expect(newToken).not.toBe(oldToken);

    const oldFeed = await app.request(`/calendar/${oldToken}.ics`);
    expect(oldFeed.status).toBe(404);

    const newFeed = await app.request(`/calendar/${newToken}.ics`);
    expect(newFeed.status).toBe(200);
  });
});

describe('calendar feed route (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  async function setupBandWithEvent(memberUserId: string) {
    const [band] = await db
      .insert(bands)
      .values({ name: 'ICS Test Band', slug: `ics-test-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);
    await db.insert(bandMembers).values({ bandId: band.id, userId: memberUserId, role: 'member', instruments: [] });

    const doc = new Y.Doc();
    doc.getMap('events').set('event-1', {
      type: 'gig',
      title: 'ICS Test Gig',
      startsAt: Date.now() + 1000 * 60 * 60 * 24,
      allDay: false,
      status: 'confirmed',
      location: 'The Venue',
    });
    doc.getMap('events').set('event-cancelled', {
      type: 'rehearsal',
      title: 'Cancelled Rehearsal',
      startsAt: Date.now() + 1000 * 60 * 60 * 48,
      allDay: false,
      status: 'cancelled',
    });
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
      snapshot: yDocToSnapshot(doc),
    });

    return band;
  }

  it('returns valid ICS data for a real token, including a cancelled event as STATUS:CANCELLED', async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);
    await setupBandWithEvent(member.userId);

    const tokenRes = await authedReq('/me/ics-token', 'GET', member.token);
    const { token } = (await tokenRes.json()) as { token: string };

    const feed = await app.request(`/calendar/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toContain('text/calendar');

    const body = await feed.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('SUMMARY:ICS Test Band: ICS Test Gig');
    expect(body).toContain('LOCATION:The Venue');
    expect(body).toContain('SUMMARY:ICS Test Band: Cancelled Rehearsal');
    expect(body).toContain('STATUS:CANCELLED');
  });

  it('404s a wrong or missing token, and a path with no .ics suffix', async () => {
    const missing = await app.request('/calendar/not-a-real-token.ics');
    expect(missing.status).toBe(404);

    const noSuffix = await app.request('/calendar/not-a-real-token');
    expect(noSuffix.status).toBe(404);
  });

  it("rechecks membership fresh on every request — leaving a band immediately stops that band's events from appearing", async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);
    const band = await setupBandWithEvent(member.userId);

    const tokenRes = await authedReq('/me/ics-token', 'GET', member.token);
    const { token } = (await tokenRes.json()) as { token: string };

    const before = await app.request(`/calendar/${token}.ics`);
    expect(await before.text()).toContain('ICS Test Gig');

    await db.delete(bandMembers).where(eq(bandMembers.bandId, band.id));

    const after = await app.request(`/calendar/${token}.ics`);
    const afterBody = await after.text();
    expect(afterBody).not.toContain('ICS Test Gig');
    expect(afterBody).toContain('BEGIN:VCALENDAR');
    expect(afterBody).toContain('END:VCALENDAR');
  });

  it('rate-limits repeated requests from the same client past the configured max', async () => {
    const member = await signUpTestUser();
    cleanupUserIds.push(member.userId);
    await setupBandWithEvent(member.userId);
    const tokenRes = await authedReq('/me/ics-token', 'GET', member.token);
    const { token } = (await tokenRes.json()) as { token: string };

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.request(`/calendar/${token}.ics`);
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
