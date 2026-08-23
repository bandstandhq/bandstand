// SPDX-License-Identifier: AGPL-3.0-or-later
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  (table) => [primaryKey({ columns: [table.bandId, table.userId] })],
);
