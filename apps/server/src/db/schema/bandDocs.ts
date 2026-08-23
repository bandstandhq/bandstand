// SPDX-License-Identifier: AGPL-3.0-or-later
import { customType } from 'drizzle-orm/pg-core';
import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';

// Drizzle has no first-class `bytea` helper.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const bandDocs = pgTable('band_docs', {
  bandId: uuid('band_id')
    .primaryKey()
    .references(() => bands.id, { onDelete: 'cascade' }),
  // Raw Yjs document state, persisted by Hocuspocus's database extension.
  yjsState: bytea('yjs_state'),
  // Plain-object projection of the Yjs doc, re-derived and Zod-validated
  // (against @bandstand/core's schemas) on every Hocuspocus store — used
  // for full-text search, PDF export, and public links, not as the source
  // of truth. Typed once apps/server depends on @bandstand/core (step 7).
  snapshot: jsonb('snapshot'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
