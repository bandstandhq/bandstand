// SPDX-License-Identifier: AGPL-3.0-or-later
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bands = pgTable('bands', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
