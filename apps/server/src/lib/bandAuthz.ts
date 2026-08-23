// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared band-membership/role check, used by both REST routes (via the Hono
// middlewares below) and Hocuspocus's onAuthenticate (which isn't a Hono
// middleware, so it calls getBandMembership directly) — one place to fix
// the membership check, not two.
import type { BandRole } from '@bandstand/core';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import { bandMembers } from '../db/schema/index';
import { auth } from './auth';

const ROLE_RANK: Record<BandRole, number> = { member: 1, admin: 2, owner: 3 };

export async function getBandMembership(
  bandId: string,
  userId: string,
): Promise<{ role: BandRole } | null> {
  const [membership] = await db
    .select({ role: bandMembers.role })
    .from(bandMembers)
    .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.userId, userId)));
  return membership ?? null;
}

export function hasAtLeastRole(role: BandRole, minRole: BandRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export type AuthVariables = { userId: string };

/** Verifies the better-auth session/bearer token; does not check band membership. */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userId', session.user.id);
  await next();
};

export type BandVariables = AuthVariables & { bandRole: BandRole };

/**
 * Requires `requireAuth` to have already run and a `:bandId` route param.
 * Rejects with 403 if the authenticated user isn't a member of that band
 * with at least `minRole`.
 */
export function requireBandRole(minRole: BandRole): MiddlewareHandler<{ Variables: BandVariables }> {
  return async (c, next) => {
    const userId = c.get('userId');
    const bandId = c.req.param('bandId');
    if (!bandId) {
      return c.json({ error: 'Missing bandId route param' }, 400);
    }

    const membership = await getBandMembership(bandId, userId);
    if (!membership || !hasAtLeastRole(membership.role, minRole)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    c.set('bandRole', membership.role);
    await next();
  };
}
