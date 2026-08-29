// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Needs a real Postgres, same bar as invites.integration.test.ts (which
// covers redemption) — this file covers invite *creation*, which had no
// rate limit at all before it was added alongside the rest of this app's
// abuse-limiting pass.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { db } from '../db/client';
import { bandMembers, bands, users } from '../db/schema/index';
import { auth } from '../lib/auth';

async function signUpTestUser() {
  const email = `invite-create-${randomUUID()}@bandstand.local`;
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: 'Invite Creator' },
  });
  if (!result.token) throw new Error('Sign-up did not return a session token');
  return { userId: result.user.id, token: result.token };
}

function createInvite(bandId: string, token: string, ip: string) {
  return app.request(`/bands/${bandId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip },
    body: JSON.stringify({ label: `Invite ${randomUUID()}`, role: 'member' }),
  });
}

describe('POST /bands/:bandId/invites rate limiting (integration)', () => {
  const cleanupUserIds: string[] = [];
  const cleanupBandIds: string[] = [];

  afterAll(async () => {
    for (const bandId of cleanupBandIds) await db.delete(bands).where(eq(bands.id, bandId));
    for (const userId of cleanupUserIds) await db.delete(users).where(eq(users.id, userId));
  });

  it('rejects the 31st invite created by the same admin within an hour', async () => {
    const owner = await signUpTestUser();
    cleanupUserIds.push(owner.userId);

    const [band] = await db
      .insert(bands)
      .values({ name: 'Invite Creation Rate Band', slug: `invite-create-rate-${randomUUID()}` })
      .returning();
    if (!band) throw new Error('Setup insert returned no row');
    cleanupBandIds.push(band.id);
    await db.insert(bandMembers).values({ bandId: band.id, userId: owner.userId, role: 'owner', instruments: [] });

    const ip = `203.0.113.${randomUUID().slice(0, 2)}`;
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await createInvite(band.id, owner.token, ip);
    }

    expect(last!.status).toBe(429);
  });
});
