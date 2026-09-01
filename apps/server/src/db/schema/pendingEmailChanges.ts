// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hybrid email-change model: the change only takes effect once the NEW
// address confirms (proves it's real and reachable — a typo in the new
// address would otherwise silently lock the account out), while the OLD
// address gets a notice with a cancel link (catches an attacker who's
// hijacked a session but doesn't control the old inbox). One row per user —
// a fresh request overwrites any earlier pending one, invalidating its
// tokens, rather than letting them accumulate.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const pendingEmailChanges = pgTable('pending_email_changes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  oldEmail: text('old_email').notNull(),
  newEmail: text('new_email').notNull(),
  confirmToken: text('confirm_token').notNull().unique(),
  cancelToken: text('cancel_token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
