// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bandRoleEnum } from './enums';
import { bands } from './bands';
import { users } from './users';

// One-time invite codes replace email-based invites entirely (see docs/adr
// for context). An owner/admin creates a code with a free-form note for
// their own reference (e.g. "for Jamie, our new bassist") and a role to
// grant; the joining person's actual name comes from their own account at
// redemption time, not from this column — despite its name, `label` was
// never the recipient's display name. The code is redeemed exactly once.
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
// win this race — no SELECT ... FOR UPDATE needed. See
// apps/server/src/routes/invites.ts for the actual endpoint, and its
// integration test for a real concurrent-redemption race.
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
    // Nullable, not notNull() — onDelete: 'set null' would otherwise violate
    // a not-null constraint the moment the creating user is deleted.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive uniqueness — redeeming is case-insensitive by spec.
    uniqueIndex('invites_code_upper_idx').on(sql`upper(${table.code})`),
    // Listing a band's invites (routes/invites.ts) filters on this alone.
    index('invites_band_id_idx').on(table.bandId),
    // One-directional on purpose: redeemedBy set without redeemedAt would be
    // a genuinely invalid state, but redeemedAt surviving after redeemedBy
    // goes NULL (the redeeming user's account was later deleted — see its
    // onDelete: 'set null' above) is a legitimate "was redeemed, by someone
    // no longer known" audit state, not a bug.
    check(
      'invites_redeemed_by_implies_redeemed_at',
      sql`${table.redeemedBy} is null or ${table.redeemedAt} is not null`,
    ),
  ],
);
