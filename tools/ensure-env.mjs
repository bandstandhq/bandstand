#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Copies .env.example to .env on first run so `pnpm install && pnpm dev`
// works with zero manual setup — never overwrites an existing .env.
import { copyFileSync, existsSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log(
    'Created .env from .env.example — it still has placeholder secrets. ' +
      'That is fine for `pnpm dev`, but the server refuses to start with them ' +
      'outside NODE_ENV=development/test (see apps/server/src/lib/envGuard.ts). ' +
      'Edit .env with real values before running anything else with it.',
  );
}
