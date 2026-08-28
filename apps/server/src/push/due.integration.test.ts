// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — proving the missing-response/upcoming-event
// reminders fire against a real seeded event and, critically, never fire
// twice for the same (user, occurrence) on a rerun (the whole reason
// push_reminder_log exists — an hourly cron would otherwise resend on
// every run within a reminder's firing window).
import { randomUUID } from 'node:crypto';
import { yDocToSnapshot } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import {
  bandDocs,
  bandMembers,
  bands,
  pushSubscriptions,
  userPrefs,
  users,
} from '../db/schema/index';
import { auth } from '../lib/auth';
import type { PushSender } from './send';
import { setPushSenderForTesting } from './send';
import { runPushDue } from './due';

async function signUpTestUser() {
  const email = `push-due-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Push Due Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return result.user.id as string;
}

describe('push/due (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];
  const originalPublic = process.env.VAPID_PUBLIC_KEY;
  const originalPrivate = process.env.VAPID_PRIVATE_KEY;

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  afterEach(() => {
    if (originalPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = originalPublic;
    if (originalPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = originalPrivate;
  });

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('reminds a member who has not answered an event ~3 days out, but only once across two runs', async () => {
    const userId = await signUpTestUser();
    cleanupUserIds.push(userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Push Due Band', slug: `push-due-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);

    await db
      .insert(bandMembers)
      .values({ bandId: band.id, userId, role: 'member', instruments: [] });
    await db.insert(userPrefs).values({
      userId,
      pushTriggers: {
        eventCreated: false,
        eventChanged: false,
        pollCreated: false,
        missingResponseReminder: true,
        upcomingEventReminder: false,
      },
    });
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: `https://push.example.test/${randomUUID()}`,
        p256dh: 'p',
        auth: 'a',
      });

    const eventId = `event-${randomUUID()}`;
    const seedDoc = new Y.Doc();
    seedDoc.getMap('events').set(eventId, {
      type: 'rehearsal',
      title: 'Reminder Rehearsal',
      startsAt: Date.now() + 1000 * 60 * 60 * 24 * 3, // ~3 days out
      allDay: false,
      status: 'confirmed',
    });
    await db.insert(bandDocs).values({
      bandId: band.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(seedDoc)),
      snapshot: yDocToSnapshot(seedDoc),
    });

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    const first = await runPushDue();
    expect(first.missingResponseSent).toBe(1);
    expect(fake.sendNotification).toHaveBeenCalledTimes(1);

    const second = await runPushDue();
    expect(second.missingResponseSent).toBe(0);
    expect(fake.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('never reminds about an event the member already answered, or a cancelled one', async () => {
    const answeredUserId = await signUpTestUser();
    const cancelledUserId = await signUpTestUser();
    cleanupUserIds.push(answeredUserId, cancelledUserId);

    const [answeredBand] = await db
      .insert(bands)
      .values({ name: 'Push Due Answered Band', slug: `push-due-answered-${randomUUID()}` })
      .returning();
    const [cancelledBand] = await db
      .insert(bands)
      .values({ name: 'Push Due Cancelled Band', slug: `push-due-cancelled-${randomUUID()}` })
      .returning();
    if (!answeredBand || !cancelledBand) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(answeredBand.id, cancelledBand.id);

    await db.insert(bandMembers).values([
      { bandId: answeredBand.id, userId: answeredUserId, role: 'member', instruments: [] },
      { bandId: cancelledBand.id, userId: cancelledUserId, role: 'member', instruments: [] },
    ]);
    for (const userId of [answeredUserId, cancelledUserId]) {
      await db.insert(userPrefs).values({
        userId,
        pushTriggers: {
          eventCreated: false,
          eventChanged: false,
          pollCreated: false,
          missingResponseReminder: true,
          upcomingEventReminder: false,
        },
      });
      await db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: `https://push.example.test/${randomUUID()}`,
          p256dh: 'p',
          auth: 'a',
        });
    }

    const answeredEventId = `event-${randomUUID()}`;
    const cancelledEventId = `event-${randomUUID()}`;
    const startsAt = Date.now() + 1000 * 60 * 60 * 24 * 3;

    const answeredDoc = new Y.Doc();
    answeredDoc
      .getMap('events')
      .set(answeredEventId, {
        type: 'rehearsal',
        title: 'Answered',
        startsAt,
        allDay: false,
        status: 'confirmed',
      });
    answeredDoc.getMap('availability').set(`${answeredEventId}:${answeredUserId}`, 'yes');
    await db.insert(bandDocs).values({
      bandId: answeredBand.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(answeredDoc)),
      snapshot: yDocToSnapshot(answeredDoc),
    });

    const cancelledDoc = new Y.Doc();
    cancelledDoc
      .getMap('events')
      .set(cancelledEventId, {
        type: 'rehearsal',
        title: 'Cancelled',
        startsAt,
        allDay: false,
        status: 'cancelled',
      });
    await db.insert(bandDocs).values({
      bandId: cancelledBand.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(cancelledDoc)),
      snapshot: yDocToSnapshot(cancelledDoc),
    });

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    const result = await runPushDue();
    expect(result.missingResponseSent).toBe(0);
    expect(fake.sendNotification).not.toHaveBeenCalled();
  });
});
