// SPDX-License-Identifier: AGPL-3.0-or-later
import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userPrefs = pgTable('user_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  personalTranspose: integer('personal_transpose').notNull().default(0),
  theme: text('theme').notNull().default('dark'),
  textSize: text('text_size').notNull().default('medium'),
});
