// SPDX-License-Identifier: AGPL-3.0-or-later
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client';

await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
console.log('Migrations applied.');
process.exit(0);
