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

export async function cleanupTestAccounts(): Promise<{ deletedUsers: number; deletedBands: number }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('cleanupTestAccounts must never run against production.');
  }

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
