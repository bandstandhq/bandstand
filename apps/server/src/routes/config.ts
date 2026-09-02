// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lets the web client discover the server/Hocuspocus URLs it should connect to at runtime,
// instead of having them baked into the build (see apps/web/src/lib/serverConfig.ts and
// docs/SELF_HOSTING.md) — so a self-hoster who changes their domain restarts the server, not
// rebuilds the web app. SERVER_URL/HOCUSPOCUS_URL are the server's own public-facing URLs,
// distinct from PORT/HOCUSPOCUS_PORT (what it actually binds to locally, which may differ behind
// a reverse proxy) — falling back to a plain localhost guess when unset so this stays harmless
// for local dev, which never calls this route anyway (see serverConfig.ts's DEV branch).
import { Hono } from 'hono';

export const config = new Hono();

config.get('/', (c) => {
  const port = process.env.PORT ?? '3001';
  const hocuspocusPort = process.env.HOCUSPOCUS_PORT ?? '3002';

  return c.json({
    serverUrl: process.env.SERVER_URL ?? `http://localhost:${port}`,
    hocuspocusUrl: process.env.HOCUSPOCUS_URL ?? `ws://localhost:${hocuspocusPort}`,
  });
});
