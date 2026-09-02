// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm cleanup:test-accounts` — a manual, self-hoster/dev-triggered
// backstop for accounts and bands a test run's own `finally`/`afterAll`
// failed to clean up (an interrupted run, a killed process — not a
// substitute for that per-test cleanup, which is the real fix; see
// apps/web/e2e-acceptance/fixtures.ts's freshEmail/freshName/
// deleteTestAccount and every *.integration.test.ts's own afterAll).
//
// Matches by the `test-` prefix every test-created account/band name now
// carries (see CONTRIBUTING.md) — deliberately an allowlist of what to
// delete, not an exclusion list of what to keep. An exclusion list (e.g.
// "everything except the three demo accounts") only stays correct as long
// as someone remembers to update it for every account that should ever be
// kept; a prefix match never touches anything it wasn't explicitly asked to.
import { like } from 'drizzle-orm';
import { db } from '../db/client';
import { bands, users } from '../db/schema/index';
import { isDevelopmentOrTest } from '../lib/envGuard';

// Fail closed, same reasoning as envGuard.ts and seed/index.ts's assertNotProduction: a bare
// `tsx src/scripts/cleanupTestAccounts.ts` never sets NODE_ENV at all, and the old
// `=== 'production'` check let that unset case straight through — the realistic way this script
// gets run outside `pnpm cleanup:test-accounts` (which now sets NODE_ENV=development itself), not
// just an edge case. A `test-`-prefixed email is plausible on a real production account (a
// support team, a QA account someone made by hand), so there's no legitimate reason for this
// backstop to ever touch a non-development/test database — no force override, unlike seed's.
export function assertNotProduction(): void {
  if (!isDevelopmentOrTest()) {
    throw new Error('cleanupTestAccounts must never run against a non-development database.');
  }
}

export async function cleanupTestAccounts(): Promise<{ deletedUsers: number; deletedBands: number }> {
  assertNotProduction();

  const deletedUsers = await db.delete(users).where(like(users.email, 'test-%')).returning({ email: users.email });
  const deletedBands = await db.delete(bands).where(like(bands.slug, 'test-%')).returning({ slug: bands.slug });

  console.log(`Deleted ${deletedUsers.length} test account(s).`);
  console.log(`Deleted ${deletedBands.length} test band(s).`);
  return { deletedUsers: deletedUsers.length, deletedBands: deletedBands.length };
}

// Only run as a CLI when invoked directly (`pnpm cleanup:test-accounts`),
// not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
