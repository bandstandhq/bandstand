// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One regenerable secret per user, gating the read-only ICS calendar
// subscription feed (docs/adr/0011-calendar-events.md) — never expires on
// its own, so regenerating (overwriting this row) is the only revocation
// mechanism a user has.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const icsFeedTokens = pgTable('ics_feed_tokens', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
