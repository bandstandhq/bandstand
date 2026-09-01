// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who becomes owner if the current owner leaves — the highest-ranked
// remaining member (admin over member), ties broken by whoever joined the
// band earliest. Shared by members.ts's GET /successor preview (so the web
// UI can name who's about to take over before the owner confirms leaving)
// and its DELETE /me handler (which re-runs the same query at commit time
// rather than trusting a client-supplied target).
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { bandMembers, users } from '../db/schema/index';

const ROLE_RANK: Record<'admin' | 'member', number> = { admin: 2, member: 1 };

export interface SuccessorCandidate {
  userId: string;
  name: string;
  role: 'admin' | 'member';
}

export async function findOwnershipSuccessor(bandId: string, currentOwnerUserId: string): Promise<SuccessorCandidate | null> {
  const rows = await db
    .select({ userId: bandMembers.userId, role: bandMembers.role, joinedAt: bandMembers.joinedAt, name: users.name })
    .from(bandMembers)
    .innerJoin(users, eq(bandMembers.userId, users.id))
    .where(and(eq(bandMembers.bandId, bandId), ne(bandMembers.userId, currentOwnerUserId)));

  // Only one owner ever exists, and it's the one just excluded above, so
  // every remaining row is necessarily 'admin' or 'member'.
  const candidates = rows as (typeof rows[number] & { role: 'admin' | 'member' })[];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const rankDiff = ROLE_RANK[b.role] - ROLE_RANK[a.role];
    if (rankDiff !== 0) return rankDiff;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });
  const winner = candidates[0]!;
  return { userId: winner.userId, name: winner.name, role: winner.role };
}
