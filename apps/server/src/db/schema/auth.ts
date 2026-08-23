// SPDX-License-Identifier: AGPL-3.0-or-later
//
// better-auth's own tables. Not part of the original data-model sketch —
// additive, required by the drizzleAdapter for session/account/verification
// storage and by the jwt() plugin for signing keys. `users.id` and every id
// column below are real Postgres uuids. apps/server/src/lib/auth.ts sets
// `advanced.database.generateId: 'uuid'`, which for Postgres means
// better-auth omits `id` from its insert payloads entirely and leaves it to
// each table's `defaultRandom()` (`gen_random_uuid()`) below — every table
// it writes to needs that default, not just `users`.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  // The stable provider-side key (with accountId) better-auth uses to
  // recognize an account, e.g. "local:credential" for email/password.
  issuer: text('issuer').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Signing keys for the jwt() plugin (needed so mobile/desktop wrappers can
// authenticate without relying on cross-origin cookies — see docs/adr).
// better-auth's internal model name for this table is itself "jwks", and
// the drizzleAdapter's `usePlural: true` naively appends "s" to whatever
// model name it looks up — so it looks for a schema export named "jwkss".
// The exported binding is named to match that; the actual SQL table name
// (first arg to pgTable) stays the sane "jwks".
export const jwkss = pgTable('jwks', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  alg: text('alg'),
  crv: text('crv'),
});
