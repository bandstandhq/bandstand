// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One row per key the hocuspocus.ts onChange guard reverted (issue #48,
// docs/adr/0005-permissions.md) — a client-originated attempt to delete a
// songs/setlists map entry outside the REST route that's meant to guard it.
// Surfaced to owner/admin in Band Settings instead of only ever showing up
// in server logs. `acknowledgedAt`/`acknowledgedBy` let an admin dismiss one
// once seen, rather than the list growing forever.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';
import { users } from './users';

export const permissionGuardWarnings = pgTable(
  'permission_guard_warnings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    mapName: text('map_name').notNull(),
    key: text('key').notNull(),
    // Nullable: the acting member could later leave/be removed, or the
    // guard could fire with no attributable user at all — the warning
    // itself should still be kept and shown either way.
    actingUserId: uuid('acting_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    // Band Settings only ever lists one band's warnings, newest first.
    index('permission_guard_warnings_band_id_idx').on(table.bandId),
  ],
);
