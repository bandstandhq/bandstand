// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Marks that this band, specifically, asked for a presigned PUT for this
// hash — `/confirm` (routes/files.ts) requires a row here, recent enough to
// still match a live presigned URL, before it will even look for a staged
// object. Without this, `/confirm` would accept any band's call for any
// hash the instant *some* band's staging upload for it happened to still be
// sitting around. See docs/adr/0007-content-addressed-files.md's original
// design and docs/adr/0015-staged-uploads.md for the two security-review
// findings this table has now been part of fixing.
//
// A presigned PUT now lands at a *band-scoped* staging key
// (`staging/<bandId>/<sha256>`, see storage.ts), not the shared
// content-addressed one — that staged object's mere existence is already
// proof this band's own upload happened, so there's nothing left for this
// table to compare a timestamp against. It previously also stored
// `baselineLastModified`, the shared object's own `LastModified` at presign
// time, so `/confirm` could tell "this band's PUT actually rewrote the
// object" from "someone else's earlier upload is just sitting there" in a
// namespace with no band-scoping at all — replaced by the staging design,
// which makes that comparison unnecessary rather than needing a better one.
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
  },
  (table) => [primaryKey({ columns: [table.bandId, table.sha256] })],
);
