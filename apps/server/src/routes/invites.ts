// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RedeemInviteErrorCode } from '@bandstand/core';
import {
  createInviteInputSchema,
  generateInviteCode,
  normalizeInviteCode,
  redeemInviteInputSchema,
} from '@bandstand/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { bandMembers, bands, invites } from '../db/schema/index';
import type { AuthVariables, BandVariables } from '../lib/bandAuthz';
import { requireAuth, requireBandRole } from '../lib/bandAuthz';
import { isUniqueViolation } from '../lib/pgErrors';
import { clientIp, createRateLimiter } from '../lib/rateLimit';

const DEFAULT_EXPIRY_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Mounted at /bands/:bandId/invites — create/list/revoke, owner+admin only. */
export const inviteManagementRoute = new Hono<{ Variables: BandVariables }>();

// Creation had no limit at all before this — only redemption did (below).
// Bounded by requireBandRole('admin') already, so the realistic case is a
// compromised or careless admin account rather than an anonymous attacker,
// but there's no reason to leave it uncapped: 30/hour is far more than any
// legitimate band admin issues in a real session, even onboarding a whole
// new lineup at once.
const createInviteRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });

inviteManagementRoute.post('/', createInviteRateLimiter(clientIp), requireBandRole('admin'), async (c) => {
  const body = createInviteInputSchema.parse(await c.req.json());
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const userId = c.get('userId');
  const expiresAt = new Date(Date.now() + (body.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * MS_PER_DAY);

  // Codes are unique (case-insensitively); on a collision, retry with a
  // freshly generated code rather than surfacing it to the caller.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [invite] = await db
        .insert(invites)
        .values({
          bandId,
          code: generateInviteCode(),
          label: body.label,
          instrument: body.instrument,
          role: body.role,
          createdBy: userId,
          expiresAt,
        })
        .returning();
      return c.json(invite, 201);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return c.json({ error: 'Could not generate a unique invite code' }, 500);
});

inviteManagementRoute.get('/', requireBandRole('admin'), async (c) => {
  const bandId = c.req.param('bandId');
  if (!bandId) return c.json({ error: 'Missing bandId' }, 400);
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.bandId, bandId))
    .orderBy(desc(invites.createdAt));
  return c.json(rows);
});

inviteManagementRoute.post('/:inviteId/revoke', requireBandRole('admin'), async (c) => {
  const bandId = c.req.param('bandId');
  const inviteId = c.req.param('inviteId');
  if (!bandId || !inviteId) return c.json({ error: 'Missing params' }, 400);

  const [invite] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.bandId, bandId),
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
      ),
    )
    .returning();

  if (!invite) {
    return c.json({ error: 'Not found, already redeemed, or already revoked' }, 404);
  }
  return c.json(invite);
});

/** Mounted at /invites — redemption isn't band-scoped, the caller only has a code. */
export const inviteRedemptionRoute = new Hono<{ Variables: AuthVariables }>();

inviteRedemptionRoute.use('*', requireAuth);

const redeemRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

inviteRedemptionRoute.post('/redeem', redeemRateLimiter(clientIp), async (c) => {
  const body = redeemInviteInputSchema.parse(await c.req.json());
  const userId = c.get('userId');
  const normalizedCode = normalizeInviteCode(body.code);

  // A non-mutating classification pass first, purely so the caller gets a
  // specific reason (docs/... none needed, RedeemInviteErrorCode is the
  // contract) instead of one generic "invalid" message. This is UX only —
  // the atomic conditional UPDATE below is still the sole race-safety
  // arbiter, unchanged, so a genuine concurrent race is still decided
  // correctly even if state moved between this check and that UPDATE.
  const [existing] = await db
    .select()
    .from(invites)
    .where(sql`upper(${invites.code}) = ${normalizedCode}`);

  if (!existing) {
    return c.json({ error: 'unknown_code' satisfies RedeemInviteErrorCode }, 404);
  }
  if (existing.revokedAt) {
    return c.json({ error: 'revoked' satisfies RedeemInviteErrorCode }, 404);
  }
  if (existing.redeemedAt) {
    return c.json({ error: 'redeemed' satisfies RedeemInviteErrorCode }, 404);
  }
  if (existing.expiresAt <= new Date()) {
    return c.json({ error: 'expired' satisfies RedeemInviteErrorCode }, 404);
  }
  const [alreadyMember] = await db
    .select()
    .from(bandMembers)
    .where(and(eq(bandMembers.bandId, existing.bandId), eq(bandMembers.userId, userId)));
  if (alreadyMember) {
    // Rejected without consuming the code — it's still valid for someone
    // else, since redeeming it wouldn't have changed anything for this
    // caller anyway (below used to silently succeed in this exact case).
    return c.json({ error: 'already_member' satisfies RedeemInviteErrorCode }, 409);
  }

  // Single conditional UPDATE — Postgres's row-level MVCC guarantees only
  // one concurrent transaction can win this race (see db/schema/invites.ts).
  const [invite] = await db
    .update(invites)
    .set({ redeemedBy: userId, redeemedAt: sql`now()` })
    .where(
      and(
        sql`upper(${invites.code}) = ${normalizedCode}`,
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
        sql`${invites.expiresAt} > now()`,
      ),
    )
    .returning();

  if (!invite) {
    // The classification above passed, but something changed in the
    // meantime (a genuine race with another redemption/revocation) — the
    // exact reason no longer matters, this is just "someone else won."
    return c.json({ error: 'redeemed' satisfies RedeemInviteErrorCode }, 404);
  }

  try {
    await db
      .insert(bandMembers)
      .values({ bandId: invite.bandId, userId, role: invite.role, instruments: [] });
  } catch (err) {
    // Already a member (bandMembers' composite PK) — the classification
    // check above should have already caught this, but stay defensive
    // against the same race window.
    if (!isUniqueViolation(err)) throw err;
  }

  const [band] = await db.select().from(bands).where(eq(bands.id, invite.bandId));
  return c.json({ band, role: invite.role });
});
