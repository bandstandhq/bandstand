// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Real Postgres + a real band Yjs document persisted to band_docs, exercised
// through the actual REST routes — same shape as
// destructiveActions.integration.test.ts, for the calendar/poll routes added
// in Milestone 3. See docs/adr/0011-calendar-events.md.
import { randomUUID } from 'node:crypto';
import { yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { bandDocs, bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';
import { bandsRoute } from './bands';

const TEMPLATE_ID = 'event-series-template';
const EXCEPTION_ID = 'event-series-exception';
const PLAIN_ID = 'event-plain';
const POLL_ID = 'poll-1';
const OPTION_A = 'option-a';
const OPTION_B = 'option-b';

async function signUpTestUser() {
  const email = `calendar-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Calendar Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function req(path: string, method: string, token: string, body?: unknown) {
  return bandsRoute.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function setupBand() {
  const admin = await signUpTestUser();
  const member = await signUpTestUser();

  const [band] = await db
    .insert(bands)
    .values({ name: 'Calendar Test Band', slug: `calendar-test-${randomUUID()}` })
    .returning();
  if (!band) throw new Error('Setup insert returned no row');

  await db.insert(bandMembers).values([
    { bandId: band.id, userId: admin.userId, role: 'admin', instruments: [] },
    { bandId: band.id, userId: member.userId, role: 'member', instruments: [] },
  ]);

  const doc = new Y.Doc();
  const events = doc.getMap('events');
  events.set(TEMPLATE_ID, {
    type: 'rehearsal',
    title: 'Weekly practice',
    startsAt: Date.parse('2026-01-05T18:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
    seriesId: TEMPLATE_ID,
    seriesRule: { freq: 'weekly' },
  });
  events.set(EXCEPTION_ID, {
    type: 'rehearsal',
    title: 'Extra long practice',
    startsAt: Date.parse('2026-01-12T17:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
    seriesId: TEMPLATE_ID,
    occurrenceDate: '2026-01-12',
  });
  events.set(PLAIN_ID, {
    type: 'gig',
    title: 'One-off show',
    startsAt: Date.parse('2026-02-01T20:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
  });

  const availability = doc.getMap('availability');
  availability.set(`${PLAIN_ID}:${member.userId}`, 'yes');
  availability.set(`${TEMPLATE_ID}@2026-01-19:${member.userId}`, 'no');
  availability.set(`${EXCEPTION_ID}:${member.userId}`, 'maybe');

  doc.getMap('polls').set(POLL_ID, {
    title: 'When works?',
    options: [
      { id: OPTION_A, startsAt: Date.parse('2026-03-01T19:00:00.000Z') },
      { id: OPTION_B, startsAt: Date.parse('2026-03-08T19:00:00.000Z') },
    ],
  });
  doc.getMap('pollVotes').set(`${POLL_ID}:${OPTION_A}:${member.userId}`, 'yes');

  await db.insert(bandDocs).values({
    bandId: band.id,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
    snapshot: yDocToSnapshot(doc),
  });

  return { band, admin, member };
}

async function loadSnapshot(bandId: string) {
  const [row] = await db.select({ snapshot: bandDocs.snapshot }).from(bandDocs).where(eq(bandDocs.bandId, bandId));
  return row?.snapshot;
}

describe('calendar event/poll routes (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects a member deleting an event, but lets an admin, clearing that event\'s own answers only', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const forbidden = await req(`/${band.id}/events/${PLAIN_ID}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/events/${PLAIN_ID}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.events[PLAIN_ID]).toBeUndefined();
    expect(snapshot?.availability[`${PLAIN_ID}:${member.userId}`]).toBeUndefined();
    // The series is untouched — only the one event was deleted.
    expect(snapshot?.events[TEMPLATE_ID]).toBeDefined();
    expect(snapshot?.events[EXCEPTION_ID]).toBeDefined();
  });

  it('deleting a single series entry leaves the rest of the series in place', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const ok = await req(`/${band.id}/events/${EXCEPTION_ID}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.events[EXCEPTION_ID]).toBeUndefined();
    expect(snapshot?.availability[`${EXCEPTION_ID}:${member.userId}`]).toBeUndefined();
    expect(snapshot?.events[TEMPLATE_ID]).toBeDefined();
    // A virtual occurrence's own answer belongs to the series, not to this
    // one deleted exception — it must survive.
    expect(snapshot?.availability[`${TEMPLATE_ID}@2026-01-19:${member.userId}`]).toBe('no');
  });

  it('?scope=series dissolves the whole series, including virtual-occurrence answers', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const ok = await req(`/${band.id}/events/${TEMPLATE_ID}?scope=series`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.events[TEMPLATE_ID]).toBeUndefined();
    expect(snapshot?.events[EXCEPTION_ID]).toBeUndefined();
    expect(snapshot?.availability[`${EXCEPTION_ID}:${member.userId}`]).toBeUndefined();
    expect(snapshot?.availability[`${TEMPLATE_ID}@2026-01-19:${member.userId}`]).toBeUndefined();
    // The unrelated plain event and its answer are untouched.
    expect(snapshot?.events[PLAIN_ID]).toBeDefined();
    expect(snapshot?.availability[`${PLAIN_ID}:${member.userId}`]).toBe('yes');
  });

  it('rejects an unknown ?scope value rather than silently treating it as a single delete', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const res = await req(`/${band.id}/events/${TEMPLATE_ID}?scope=everything`, 'DELETE', admin.token);
    expect(res.status).toBe(400);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.events[TEMPLATE_ID]).toBeDefined();
  });

  it('rejects a member closing a poll, but lets an admin — creating the event and resolving the poll together', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const body = { optionId: OPTION_B, title: 'Agreed rehearsal', type: 'rehearsal' as const };

    const forbidden = await req(`/${band.id}/polls/${POLL_ID}/close`, 'POST', member.token, body);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/polls/${POLL_ID}/close`, 'POST', admin.token, body);
    expect(ok.status).toBe(200);
    const { eventId } = (await ok.json()) as { eventId: string };

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.polls[POLL_ID]?.resolvedEventId).toBe(eventId);
    expect(snapshot?.events[eventId]).toMatchObject({
      title: 'Agreed rehearsal',
      type: 'rehearsal',
      startsAt: Date.parse('2026-03-08T19:00:00.000Z'),
      status: 'confirmed',
    });
  });

  it('refuses to close an already-closed poll, leaving the original resolution intact', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const first = await req(`/${band.id}/polls/${POLL_ID}/close`, 'POST', admin.token, {
      optionId: OPTION_A,
      title: 'First close',
      type: 'rehearsal',
    });
    expect(first.status).toBe(200);
    const { eventId } = (await first.json()) as { eventId: string };

    const second = await req(`/${band.id}/polls/${POLL_ID}/close`, 'POST', admin.token, {
      optionId: OPTION_B,
      title: 'Second close',
      type: 'gig',
    });
    expect(second.status).toBe(409);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.polls[POLL_ID]?.resolvedEventId).toBe(eventId);
    expect(Object.values(snapshot?.events ?? {}).filter((e) => e.title === 'Second close')).toHaveLength(0);
  });

  it('rejects closing a poll on an option that does not belong to it, creating no event', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const before = await loadSnapshot(band.id);
    const res = await req(`/${band.id}/polls/${POLL_ID}/close`, 'POST', admin.token, {
      optionId: 'not-an-option',
      title: 'Should not exist',
      type: 'gig',
    });
    expect(res.status).toBe(400);

    const after = await loadSnapshot(band.id);
    expect(Object.keys(after?.events ?? {})).toEqual(Object.keys(before?.events ?? {}));
    expect(after?.polls[POLL_ID]?.resolvedEventId).toBeUndefined();
  });

  it('rejects a member deleting a poll, but lets an admin, clearing its votes', async () => {
    const { band, admin, member } = await setupBand();
    cleanupUserIds.push(admin.userId, member.userId);
    cleanupBandIds.push(band.id);

    const forbidden = await req(`/${band.id}/polls/${POLL_ID}`, 'DELETE', member.token);
    expect(forbidden.status).toBe(403);

    const ok = await req(`/${band.id}/polls/${POLL_ID}`, 'DELETE', admin.token);
    expect(ok.status).toBe(200);

    const snapshot = await loadSnapshot(band.id);
    expect(snapshot?.polls[POLL_ID]).toBeUndefined();
    expect(snapshot?.pollVotes[`${POLL_ID}:${OPTION_A}:${member.userId}`]).toBeUndefined();
  });
});
