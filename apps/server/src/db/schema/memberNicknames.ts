// SPDX-License-Identifier: AGPL-3.0-or-later
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';
import { users } from './users';

// A nickname is strictly private to the viewer who set it — never synced to
// the band's Yjs doc, same reasoning as userPrefs.songNotes. Scoped by band
// (not global) since the same two people can be in more than one band
// together with a different nickname making sense in each.
export const memberNicknames = pgTable(
  'member_nicknames',
  {
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    viewerUserId: uuid('viewer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.bandId, table.viewerUserId, table.targetUserId] })],
);
