// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export const health = new Hono();

health.get('/', async (c) => {
  const dbStatus = await db
    .execute(sql`select 1`)
    .then(() => 'ok' as const)
    .catch(() => 'down' as const);

  return c.json({ status: 'ok', db: dbStatus });
});
