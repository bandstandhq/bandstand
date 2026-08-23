// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bandRoleEnum } from './enums';
import { bands } from './bands';
import { users } from './users';

// One-time invite codes replace email-based invites entirely (see docs/adr
// for context). An owner/admin creates a code labeled for a specific
// intended recipient (display name + optional instrument) and a role to
// grant; the code is redeemed exactly once.
//
// Atomic redemption is a single conditional UPDATE, not a read-then-write:
//   UPDATE invites
//   SET redeemed_by = $userId, redeemed_at = now()
//   WHERE id = $id
//     AND redeemed_at IS NULL
//     AND revoked_at IS NULL
//     AND expires_at > now()
//   RETURNING *;
// Postgres's row-level MVCC guarantees only one concurrent transaction can
// win this race — no SELECT ... FOR UPDATE needed. (Endpoint implementing
// this is out of scope for Milestone 0; this comment documents the intended
// query shape so it isn't lost.)
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    // 6 chars from a confusion-resistant alphabet (no 0/O/1/I/l), generated
    // by application code — see packages/core's generateInviteCode (added
    // alongside the real redemption endpoint).
    code: text('code').notNull(),
    label: text('label').notNull(),
    instrument: text('instrument'),
    role: bandRoleEnum('role').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive uniqueness — redeeming is case-insensitive by spec.
    uniqueIndex('invites_code_upper_idx').on(sql`upper(${table.code})`),
    check(
      'invites_redeemed_pair_consistent',
      sql`(${table.redeemedAt} is null) = (${table.redeemedBy} is null)`,
    ),
  ],
);
