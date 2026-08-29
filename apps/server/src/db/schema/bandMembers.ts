// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bandRoleEnum } from './enums';
import { bands } from './bands';
import { users } from './users';

export const bandMembers = pgTable(
  'band_members',
  {
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: bandRoleEnum('role').notNull(),
    instruments: text('instruments').array().notNull().default([]),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.bandId, table.userId] }),
    // A DB-level backstop for "a band always has exactly one owner" —
    // independent of the ownership-transfer endpoint's own transaction
    // getting that invariant right (see apps/server/src/routes/bands.ts).
    uniqueIndex('band_members_one_owner_idx').on(table.bandId).where(sql`${table.role} = 'owner'`),
    // `userId` is only the non-leading column of the (bandId, userId)
    // primary key, which doesn't serve a userId-only lookup — needed by
    // "list my bands" (routes/bands.ts) and the ICS feed's per-request
    // membership recheck (routes/calendarFeed.ts).
    index('band_members_user_id_idx').on(table.userId),
  ],
);
