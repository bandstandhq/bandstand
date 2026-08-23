// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

// Runs only *.integration.test.ts against a real Postgres — see
// .github/workflows/ci.yml's `integration` job and `pnpm test:integration`.
//
// pool: 'forks' is load-bearing, not a preference: against a genuinely
// fresh Postgres role (as in a brand-new CI service container), `pg`'s
// SASL/SCRAM handshake fails inside Vitest's default worker_threads pool
// with "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a
// string" — reproduced locally against a disposable postgres:16 container
// and confirmed stable across repeated runs once switched to 'forks'. An
// already-"warmed" long-lived local Postgres (e.g. one that's had plenty
// of non-worker-thread connections) doesn't show the bug, which is what
// made this easy to miss testing only against a long-running local DB.
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    pool: 'forks',
  },
});
