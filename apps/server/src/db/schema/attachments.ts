// SPDX-License-Identifier: AGPL-3.0-or-later
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';
import { users } from './users';

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  bandId: uuid('band_id')
    .notNull()
    .references(() => bands.id, { onDelete: 'cascade' }),
  // References a song inside the band's Yjs document (songs live in Yjs,
  // not Postgres), so this is a plain string id, not a foreign key.
  songId: text('song_id'),
  key: text('key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});
