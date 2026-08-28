// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The actual sending half of web push — subscribe/prefs (routes/push.ts)
// and the SW-side receive/display (apps/web/src/sw.ts) are separate
// concerns. Called from two places: hocuspocus.ts's onChange (event/poll
// creation and event changes, observed live off the shared Yjs doc — see
// docs/adr/0012-web-push.md for why that's the hook point rather than a
// REST route, since ordinary event/poll creation is a plain CRDT write with
// no server route in front of it) and push/due.ts (the two time-based
// reminders).
import type { PushPayload, PushTriggers } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../db/client';
import { pushSubscriptions, userPrefs } from '../db/schema/index';
import { getVapidConfig, hasVapidKeys } from './config';

/**
 * Narrow slice of `web-push`'s own API — swapped for a fake in tests so
 * nothing here ever makes a real network call. The default export wraps
 * the real `web-push` module.
 */
export interface PushSender {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ): Promise<unknown>;
}

class WebPushSender implements PushSender {
  private vapidConfigured = false;

  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) {
    if (!this.vapidConfigured) {
      const { subject, publicKey, privateKey } = getVapidConfig();
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
    }
    return webpush.sendNotification(subscription, payload);
  }
}

let sender: PushSender = new WebPushSender();

/** Test-only seam — see push/send.test.ts. Never call this outside a test. */
export function setPushSenderForTesting(fake: PushSender): void {
  sender = fake;
}

function isGoneError(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

/**
 * Sends to every device `userId` has subscribed, provided their own
 * `pushTriggers[trigger]` is enabled — silently does nothing if push isn't
 * configured server-wide, the user hasn't opted into this trigger, or they
 * have no subscriptions at all. A subscription the push service reports as
 * gone (404/410 — the browser dropped it, e.g. after being uninstalled) is
 * deleted so it's not retried forever.
 */
export async function sendPushToUser(
  userId: string,
  trigger: keyof PushTriggers,
  payload: PushPayload,
): Promise<void> {
  if (!hasVapidKeys()) return;

  const [prefs] = await db
    .select({ pushTriggers: userPrefs.pushTriggers })
    .from(userPrefs)
    .where(eq(userPrefs.userId, userId));
  const triggers = prefs?.pushTriggers as PushTriggers | undefined;
  if (!triggers?.[trigger]) return;

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const json = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sender.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          json,
        );
      } catch (err) {
        if (isGoneError(err)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        } else {
          console.warn('[push] send failed', {
            userId,
            trigger,
            endpoint: subscription.endpoint,
            error: err,
          });
        }
      }
    }),
  );
}

/** Same as `sendPushToUser`, for every id in `userIds` except `excludeUserId` — a user's own action never notifies them. */
export async function sendPushToUsers(
  userIds: string[],
  excludeUserId: string | undefined,
  trigger: keyof PushTriggers,
  payload: PushPayload,
): Promise<void> {
  if (!hasVapidKeys()) return;
  await Promise.all(
    userIds.filter((id) => id !== excludeUserId).map((id) => sendPushToUser(id, trigger, payload)),
  );
}
