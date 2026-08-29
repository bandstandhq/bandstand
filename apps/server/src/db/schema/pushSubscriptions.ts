// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One row per subscribed device/browser (unlike userPrefs/icsFeedTokens, a
// user can have several — a phone and a laptop both subscribed at once).
// `endpoint` is the whole identity of a subscription as far as the push
// service is concerned, so it's the unique key; re-subscribing the same
// device (e.g. after clearing site data) just overwrites its row rather
// than accumulating duplicates.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    // A short caller-supplied label ("Chrome on this laptop") so a settings
    // page can list subscribed devices meaningfully — never inferred
    // server-side from the user agent.
    deviceLabel: text('device_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Looked up per userId on every push send (push/send.ts), fanned out to
  // every band member on each event/poll notification.
  (table) => [index('push_subscriptions_user_id_idx').on(table.userId)],
);
