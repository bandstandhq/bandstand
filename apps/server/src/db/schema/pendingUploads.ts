// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Marks that this band, specifically, asked for a presigned PUT for this
// hash — `/confirm` (routes/files.ts) requires a row here (recent enough to
// still match a live presigned URL) and requires proof the object was
// actually rewritten since. Without this, `/confirm` only ever checked that
// *some* object existed at the content-addressed key — satisfiable by any
// band for a hash it never uploaded, since the object store's namespace is
// global, not band-scoped. See docs/adr/0007-content-addressed-files.md's
// original design and the security review that found the gap.
//
// `baselineLastModified` is the object's own `LastModified` (from the
// object store, not this server's clock) at the moment this row was
// written — `null` if no object existed at this hash yet. `/confirm`
// requires the *current* `LastModified` to be strictly newer than this
// baseline, which needs no clock-skew tolerance at all: both readings come
// from the same clock (the object store's), so they're directly comparable
// even if this server's own clock disagrees with it.
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';

export const pendingUploads = pgTable(
  'pending_uploads',
  {
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    // Not an FK — a sha256 has no existence of its own outside the object
    // store, same as `attachments.sha256`.
    sha256: text('sha256').notNull(),
    presignedAt: timestamp('presigned_at', { withTimezone: true }).notNull().defaultNow(),
    baselineLastModified: timestamp('baseline_last_modified', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.bandId, table.sha256] })],
);
