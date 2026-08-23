// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_USER_PREFS, type UserPrefs, updateUserPrefsInputSchema, userPrefsSchema } from '@bandstand/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { userPrefs } from '../db/schema/index';
import type { AuthVariables } from '../lib/bandAuthz';
import { requireAuth } from '../lib/bandAuthz';

export const userPrefsRoute = new Hono<{ Variables: AuthVariables }>();

userPrefsRoute.use('*', requireAuth);

userPrefsRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const [row] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
  if (!row) return c.json(DEFAULT_USER_PREFS);

  const { userId: _userId, ...prefs } = row;
  return c.json(userPrefsSchema.parse(prefs));
});

userPrefsRoute.patch('/', async (c) => {
  const userId = c.get('userId');
  const patch = updateUserPrefsInputSchema.parse(await c.req.json());

  const [existing] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
  const current: UserPrefs = existing
    ? userPrefsSchema.parse({ ...existing })
    : DEFAULT_USER_PREFS;
  const merged = userPrefsSchema.parse({ ...current, ...patch });

  await db
    .insert(userPrefs)
    .values({ userId, ...merged })
    .onConflictDoUpdate({ target: userPrefs.userId, set: merged });

  return c.json(merged);
});
