#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Verifies every .ts/.tsx source file carries the SPDX header matching its
// package's license: AGPL-3.0-or-later under apps/server/, Apache-2.0
// everywhere else. Run via `pnpm license:check`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.git',
  'coverage',
  'playwright-report',
  'ios',
  'android',
  'target',
  'gen',
]);

/** @type {string[]} */
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
}

walk(ROOT);

const missing = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const expected = rel.startsWith(`apps${'/'}server${'/'}`)
    ? 'AGPL-3.0-or-later'
    : 'Apache-2.0';
  const head = readFileSync(file, 'utf8').split('\n', 5).join('\n');
  if (!head.includes(`SPDX-License-Identifier: ${expected}`)) {
    missing.push({ rel, expected });
  }
}

if (missing.length > 0) {
  console.error(`Missing/incorrect SPDX header in ${missing.length} file(s):\n`);
  for (const { rel, expected } of missing) {
    console.error(`  ${rel} — expected "SPDX-License-Identifier: ${expected}"`);
  }
  process.exit(1);
}

console.log(`SPDX headers OK (${files.length} files checked).`);
