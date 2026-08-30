// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres — proving the trigger-preference check and
// subscription lookup work against real rows. The actual push service is
// never called; a fake PushSender stands in (see setPushSenderForTesting).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { pushSubscriptions, userPrefs, users } from '../db/schema/index';
import { auth } from '../lib/auth';
import type { PushSender } from './send';
import { sendPushToUser, sendPushToUsers, setPushSenderForTesting } from './send';

async function signUpTestUser() {
  const email = `test-push-send-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Push Send Tester' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return result.user.id as string;
}

async function enableTrigger(userId: string, trigger: string) {
  await db
    .insert(userPrefs)
    .values({
      userId,
      pushTriggers: {
        eventCreated: false,
        eventChanged: false,
        pollCreated: false,
        missingResponseReminder: false,
        upcomingEventReminder: false,
        [trigger]: true,
      },
    })
    .onConflictDoUpdate({
      target: userPrefs.userId,
      set: {
        pushTriggers: {
          eventCreated: false,
          eventChanged: false,
          pollCreated: false,
          missingResponseReminder: false,
          upcomingEventReminder: false,
          [trigger]: true,
        },
      },
    });
}

async function addSubscription(userId: string, endpoint: string) {
  await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh: 'p', auth: 'a' });
}

describe('push/send (integration)', () => {
  const cleanupUserIds: string[] = [];
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
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('sends to every subscribed device when the trigger is enabled', async () => {
    const userId = await signUpTestUser();
    cleanupUserIds.push(userId);
    await enableTrigger(userId, 'eventCreated');
    await addSubscription(userId, `https://push.example.test/${randomUUID()}`);
    await addSubscription(userId, `https://push.example.test/${randomUUID()}`);

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    await sendPushToUser(userId, 'eventCreated', {
      title: 'New event',
      body: 'Rehearsal',
      url: '/x',
    });

    expect(fake.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('never sends when the trigger is disabled', async () => {
    const userId = await signUpTestUser();
    cleanupUserIds.push(userId);
    await enableTrigger(userId, 'pollCreated'); // a different trigger than the one we test
    await addSubscription(userId, `https://push.example.test/${randomUUID()}`);

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    await sendPushToUser(userId, 'eventCreated', {
      title: 'New event',
      body: 'Rehearsal',
      url: '/x',
    });

    expect(fake.sendNotification).not.toHaveBeenCalled();
  });

  it('deletes a subscription the push service reports as gone (410)', async () => {
    const userId = await signUpTestUser();
    cleanupUserIds.push(userId);
    await enableTrigger(userId, 'eventCreated');
    const endpoint = `https://push.example.test/${randomUUID()}`;
    await addSubscription(userId, endpoint);

    const fake: PushSender = {
      sendNotification: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 })),
    };
    setPushSenderForTesting(fake);

    await sendPushToUser(userId, 'eventCreated', {
      title: 'New event',
      body: 'Rehearsal',
      url: '/x',
    });

    const [row] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row).toBeUndefined();
  });

  it('sendPushToUsers never notifies the excluded (acting) user', async () => {
    const actorId = await signUpTestUser();
    const otherId = await signUpTestUser();
    cleanupUserIds.push(actorId, otherId);
    await enableTrigger(actorId, 'eventCreated');
    await enableTrigger(otherId, 'eventCreated');
    await addSubscription(actorId, `https://push.example.test/${randomUUID()}`);
    await addSubscription(otherId, `https://push.example.test/${randomUUID()}`);

    const fake: PushSender = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    setPushSenderForTesting(fake);

    await sendPushToUsers([actorId, otherId], actorId, 'eventCreated', {
      title: 'New event',
      body: 'Rehearsal',
      url: '/x',
    });

    expect(fake.sendNotification).toHaveBeenCalledTimes(1);
  });
});
