// SPDX-License-Identifier: AGPL-3.0-or-later
import { serve } from '@hono/node-server';
import { app } from './app';
import { hocuspocusServer } from './lib/hocuspocus';
import { warnOnceIfMissing } from './push/config';

const port = Number(process.env.PORT ?? 3001);

warnOnceIfMissing();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Bandstand API listening on http://localhost:${info.port}`);
});

await hocuspocusServer.listen();
console.log(`Hocuspocus (band doc sync) listening on ${hocuspocusServer.configuration.port}`);
