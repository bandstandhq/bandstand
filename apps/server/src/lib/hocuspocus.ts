// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hocuspocus runs as its own WebSocket server on HOCUSPOCUS_PORT, separate
// from the Hono HTTP API — mounting a raw WebSocket upgrade onto Hono's
// (Node-only) HTTP server would need extra glue Hocuspocus's own .listen()
// already provides. `documentName` is the bandId; band_docs.band_id is the
// persistence key for the Database extension below.
//
// M0 scope: onAuthenticate verifies the better-auth session/JWT via the
// bearer plugin. It does NOT yet check that the authenticated user is a
// member of the requested band — see the `security`-labeled GitHub issue
// filed for that gap.
import { bandSnapshotSchema, yDocToSnapshot } from '@bandstand/core';
import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bandDocs } from '../db/schema/index';
import { auth } from './auth';

export const hocuspocusServer = new Server({
  port: Number(process.env.HOCUSPOCUS_PORT ?? 3002),
  async onAuthenticate({ token, documentName }) {
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });

    if (!session) {
      throw new Error('Unauthorized');
    }

    return { userId: session.user.id, bandId: documentName };
  },
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const [row] = await db
          .select({ yjsState: bandDocs.yjsState })
          .from(bandDocs)
          .where(eq(bandDocs.bandId, documentName));
        return row?.yjsState ?? null;
      },
      store: async ({ documentName, state, document }) => {
        const snapshot = bandSnapshotSchema.parse(yDocToSnapshot(document));
        await db
          .insert(bandDocs)
          .values({ bandId: documentName, yjsState: state, snapshot, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: bandDocs.bandId,
            set: { yjsState: state, snapshot, updatedAt: new Date() },
          });
      },
    }),
  ],
  debounce: 2000,
  maxDebounce: 10000,
});
