// SPDX-License-Identifier: AGPL-3.0-or-later
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './lib/auth';
import { hocuspocusServer } from './lib/hocuspocus';
import { health } from './routes/health';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: [process.env.WEB_ORIGIN ?? 'http://localhost:5173'],
    credentials: true,
  }),
);

app.route('/health', health);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Bandstand API listening on http://localhost:${info.port}`);
});

await hocuspocusServer.listen();
console.log(`Hocuspocus (band doc sync) listening on ${hocuspocusServer.configuration.port}`);
