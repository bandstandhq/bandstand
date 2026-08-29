// SPDX-License-Identifier: AGPL-3.0-or-later
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { auth } from './lib/auth';
import { hocuspocusServer } from './lib/hocuspocus';
import { bandsRoute } from './routes/bands';
import { calendarFeedRoute } from './routes/calendarFeed';
import { health } from './routes/health';
import { icsTokenRoute } from './routes/icsToken';
import { inviteRedemptionRoute } from './routes/invites';
import { pushRoute } from './routes/push';
import { userPrefsRoute } from './routes/userPrefs';
import { warnOnceIfMissing } from './push/config';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: [process.env.WEB_ORIGIN ?? 'http://localhost:5173'],
    credentials: true,
  }),
);

// A schema.parse(await c.req.json()) failing anywhere is a malformed
// request, not a server fault — without this, Hono's default handler
// answers every one of those with a generic 500, indistinguishable from a
// real crash in logs/monitoring. `details` deliberately carries only path
// and error code, never the offending `message`/`received` value some Zod
// issue codes include, so a client probing this endpoint learns what field
// is wrong but not what value the server would have accepted.
app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      { error: 'Invalid request', details: err.issues.map((issue) => ({ path: issue.path, code: issue.code })) },
      400,
    );
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

app.route('/health', health);
app.route('/bands', bandsRoute);
app.route('/invites', inviteRedemptionRoute);
app.route('/me/prefs', userPrefsRoute);
app.route('/me/ics-token', icsTokenRoute);
app.route('/calendar', calendarFeedRoute);
app.route('/push', pushRoute);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

const port = Number(process.env.PORT ?? 3001);

warnOnceIfMissing();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Bandstand API listening on http://localhost:${info.port}`);
});

await hocuspocusServer.listen();
console.log(`Hocuspocus (band doc sync) listening on ${hocuspocusServer.configuration.port}`);
