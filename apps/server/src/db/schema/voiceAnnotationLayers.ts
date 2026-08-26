// SPDX-License-Identifier: AGPL-3.0-or-later
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bands } from './bands';
import { users } from './users';

// Strictly personal drawing/markup on a voice — never in the band's Yjs
// document (see packages/core/src/schemas/annotation.ts and B4 of the
// Milestone 2 Teil B plan). `voiceId` is a Yjs voice id (e.g.
// "voice:<uuid>"), not a foreign key — voices live in the band doc, not
// this table. `sourceLayerId` is a soft pointer (no FK constraint, to avoid
// a self-referencing-table typing dance for what's a rare, non-critical
// link) from a *shared* copy back to the personal layer it was copied
// from — sharing is a copy, not a live link, so the shared row survives
// even if the source layer is later edited or deleted (in which case
// `sourceLayerId` just points at nothing, and only an admin/owner, not the
// original sharer, can still remove it — see docs/PERMISSIONS.md).
export const voiceAnnotationLayers = pgTable(
  'voice_annotation_layers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    voiceId: text('voice_id').notNull(),
    // The owning member — null only for a shared copy, which has no live
    // owner of its own (see sourceLayerId above).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    objects: jsonb('objects').notNull().default([]),
    shared: boolean('shared').notNull().default(false),
    sourceLayerId: uuid('source_layer_id'),
    // Explicit millisecond precision (Postgres's default is microsecond) —
    // this column doubles as the optimistic-concurrency token for the
    // conditional update in routes/annotations.ts (`expectedUpdatedAt`),
    // which round-trips through a JS `Date`/ISO string on the wire. `Date`
    // only ever has millisecond resolution, so without pinning the column
    // to match, a value read back and sent right back as `expectedUpdatedAt`
    // would silently fail to equal the stored (microsecond-precision) value
    // — every update would look "stale" and needlessly fork, even the very
    // first one on a freshly created layer.
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [index('voice_annotation_layers_voice_user_idx').on(table.voiceId, table.userId)],
);
