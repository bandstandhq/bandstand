// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subscription management + per-trigger opt-in — see docs/adr/0012-web-
// push.md. Actually *sending* a notification (push/send.ts) is a separate
// concern called from event/poll route handlers and the push:due script,
// not from here.
import { DEFAULT_USER_PREFS, pushPrefInputSchema, subscribePushInputSchema, userPrefsSchema } from '@bandstand/core';
import type { UserPrefs } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { pushSubscriptions, userPrefs } from '../db/schema/index';
import type { AuthVariables } from '../lib/bandAuthz';
import { requireAuth } from '../lib/bandAuthz';

export const pushRoute = new Hono<{ Variables: AuthVariables }>();

pushRoute.use('*', requireAuth);

/**
 * Idempotent by `endpoint` — re-subscribing the same device (a fresh
 * `pushManager.subscribe()` call, e.g. after clearing site data or after
 * this endpoint expired and the browser silently rotated it) just updates
 * the existing row, including handing it to whichever account is signed in
 * now if that's changed.
 */
pushRoute.post('/subscribe', async (c) => {
  const userId = c.get('userId');
  const input = subscribePushInputSchema.parse(await c.req.json());

  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      deviceLabel: input.deviceLabel,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, deviceLabel: input.deviceLabel },
    });

  return c.body(null, 204);
});

/** Only the subscription's own owner can remove it. */
pushRoute.delete('/subscribe/:endpoint', async (c) => {
  const userId = c.get('userId');
  const endpoint = decodeURIComponent(c.req.param('endpoint'));

  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));

  return c.body(null, 204);
});

/**
 * One trigger at a time, merged into whatever `pushTriggers` already
 * exists — a generic `PATCH /me/prefs {pushTriggers: {...}}` would replace
 * the whole object, silently resetting every other trigger a client
 * didn't happen to include.
 */
pushRoute.patch('/prefs', async (c) => {
  const userId = c.get('userId');
  const { trigger, enabled } = pushPrefInputSchema.parse(await c.req.json());

  const [existing] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
  const current: UserPrefs = existing ? userPrefsSchema.parse({ ...existing }) : DEFAULT_USER_PREFS;
  const nextTriggers = { ...current.pushTriggers, [trigger]: enabled };
  const merged = userPrefsSchema.parse({ ...current, pushTriggers: nextTriggers });

  await db
    .insert(userPrefs)
    .values({ userId, ...merged })
    .onConflictDoUpdate({ target: userPrefs.userId, set: merged });

  return c.json({ pushTriggers: nextTriggers });
});
