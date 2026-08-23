// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

// Integration tests need a real Postgres (see .github/workflows/ci.yml's
// `integration` job) and are excluded from the default `test` script so
// contributors without Docker running locally aren't blocked.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
