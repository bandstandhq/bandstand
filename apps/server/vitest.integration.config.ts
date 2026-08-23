// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

// Runs only *.integration.test.ts against a real Postgres — see
// .github/workflows/ci.yml's `integration` job and `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
