#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Copies .env.example to .env on first run so `pnpm install && pnpm dev`
// works with zero manual setup — never overwrites an existing .env.
import { copyFileSync, existsSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (edit it to customize).');
}
