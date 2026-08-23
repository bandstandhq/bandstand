// SPDX-License-Identifier: AGPL-3.0-or-later
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  // emailVerified/updatedAt are required by better-auth's base user schema;
  // not in the original data-model sketch but additive, not conflicting
  // with it. better-auth's `image` field maps onto avatarUrl above via
  // `user.fields.image` in lib/auth.ts, rather than duplicating the column.
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
