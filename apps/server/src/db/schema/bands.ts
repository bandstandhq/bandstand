// SPDX-License-Identifier: AGPL-3.0-or-later
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bands = pgTable('bands', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set instead of a hard delete for a production band (see bands.ts's
  // DELETE route) — the owner can restore any time before
  // sweepArchived.ts's 30-day grace period elapses and permanently removes
  // it. Development data and anything named like a test fixture (slug
  // starting with "test-") still deletes immediately, same as before.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});
