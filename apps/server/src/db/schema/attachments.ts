// SPDX-License-Identifier: AGPL-3.0-or-later
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';
import { users } from './users';

// A per-band ledger of uploaded blobs, not a per-voice-file reference table
// — a voice's files array (packages/core/src/schemas/voice.ts) stores
// {sha256, filename, mime, pageCount} inline in the Yjs document, so this
// table exists only so "does this blob already exist for this band" is a
// fast lookup and so `pnpm blobs:gc` has something to reconcile against.
// See docs/adr/0007-content-addressed-files.md.
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    // Display name only, from whoever uploaded it first — not part of the
    // blob's identity (two members may call the same content different
    // things).
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('attachments_band_id_sha256_idx').on(table.bandId, table.sha256)],
);
