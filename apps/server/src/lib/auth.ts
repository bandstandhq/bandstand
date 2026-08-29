// SPDX-License-Identifier: AGPL-3.0-or-later
//
// better-auth wiring. Milestone 0 scope: email/password + password-reset
// only — no magic link. jwt()/bearer() stay regardless of login method,
// since the mobile/desktop wrappers need token auth independent of it
// (cross-origin cookies are unreliable in capacitor:///tauri:// WebViews —
// see docs/adr/0001-monorepo-thin-wrapper.md).
//
// Integration notes (see docs/adr for the full writeup):
// - Our tables are pluralized (`users`, `sessions`, ...) -> usePlural: true.
// - `users.id` is a real Postgres uuid; better-auth's default id generator
//   produces non-uuid strings, so advanced.database.generateId: 'uuid'
//   makes it use `gen_random_uuid()` instead.
// - better-auth's base user schema wants an `image` field; we call it
//   `avatarUrl` (per the brief's `avatar_url` column) — mapped via
//   user.fields instead of adding a duplicate column.
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { bearer, jwt } from 'better-auth/plugins';
import { db } from '../db/client';
import * as schema from '../db/schema/index';
import { parseAllowedOrigins } from './corsOrigins';
import { assertNotDevPlaceholder } from './envGuard';
import { sendMail } from './mailer';

// Same convention as storage.ts's MinIO credentials: this is a placeholder
// value shipped in .env.example, and a self-hoster who never changes it
// would otherwise sign every session/JWT with a secret published in this
// repo's own git history.
assertNotDevPlaceholder('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET, 'dev-only-secret-change-me');

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET,
  // Must track app.ts's CORS origin list exactly — better-auth checks this
  // itself (Origin/CSRF checks on its own routes) independently of Hono's
  // own cors() middleware, so a mismatch here would 403 auth requests from
  // an origin the rest of the API already accepts (this is exactly what
  // broke local LAN testing before WEB_ORIGIN supported more than one
  // origin — see CONTRIBUTING.md's "Testing on mobile devices" section).
  trustedOrigins: parseAllowedOrigins(process.env.WEB_ORIGIN),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
    usePlural: true,
  }),
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  user: {
    fields: {
      image: 'avatarUrl',
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        user.email,
        'Reset your Bandstand password',
        `<p>Click <a href="${url}">here</a> to reset your password. If you didn't request this, ignore this email.</p>`,
      );
    },
  },
  plugins: [jwt(), bearer()],
});
