// SPDX-License-Identifier: Apache-2.0
//
// Self-heals the one thing apps/server/src/scripts/cleanupTestAccounts.ts's
// own doc comment calls out as its reason to exist: an interrupted run or a
// killed process whose own finally/afterAll never got to clean up after
// itself. Running it before every acceptance suite invocation means stale
// `test-`-prefixed accounts/bands from a previous crashed/ctrl-C'd run
// never silently accumulate in a local dev database — a no-op in CI, where
// the acceptance workflow's Postgres starts fresh every time anyway.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup(): void {
  execFileSync('pnpm', ['--filter', '@bandstand/server', 'cleanup:test-accounts'], {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
  });
}
