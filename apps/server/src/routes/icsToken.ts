// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Personal, non-band-scoped — same shape as userPrefs.ts. See
// docs/adr/0011-calendar-events.md for the ICS feed this token gates.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { icsFeedTokens } from '../db/schema/index';
import type { AuthVariables } from '../lib/bandAuthz';
import { requireAuth } from '../lib/bandAuthz';

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export const icsTokenRoute = new Hono<{ Variables: AuthVariables }>();

icsTokenRoute.use('*', requireAuth);

/** Lazily provisions a token on first read — a feed URL always "exists" from the caller's point of view; regenerating is the explicit revoke action. */
icsTokenRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const [existing] = await db.select({ token: icsFeedTokens.token }).from(icsFeedTokens).where(eq(icsFeedTokens.userId, userId));
  if (existing) return c.json({ token: existing.token });

  await db.insert(icsFeedTokens).values({ userId, token: generateToken() }).onConflictDoNothing();
  // Re-select rather than trust the value just generated — a concurrent
  // first request could have already won the insert (onConflictDoNothing
  // silently no-ops in that case), so this returns whichever token
  // actually landed, not necessarily this request's own.
  const [row] = await db.select({ token: icsFeedTokens.token }).from(icsFeedTokens).where(eq(icsFeedTokens.userId, userId));
  return c.json({ token: row!.token });
});

/** The only revocation mechanism: overwriting the row immediately invalidates the old URL everywhere it was shared. */
icsTokenRoute.post('/regenerate', async (c) => {
  const userId = c.get('userId');
  const token = generateToken();
  await db
    .insert(icsFeedTokens)
    .values({ userId, token })
    .onConflictDoUpdate({ target: icsFeedTokens.userId, set: { token, createdAt: new Date() } });
  return c.json({ token });
});
