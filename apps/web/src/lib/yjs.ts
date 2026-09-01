// SPDX-License-Identifier: Apache-2.0
//
// The sync path described in docs/ARCHITECTURE.md: a Y.Doc backed by
// IndexedDB locally (works offline once loaded) and synced to the server
// over Hocuspocus when a connection is available. See hooks/useBandDoc.ts
// for the React-facing wrapper feature pages actually use.
import { HocuspocusProvider } from '@hocuspocus/provider';
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { getActiveServerConfig } from './serverConfig';

export interface BandDocConnection {
  doc: Y.Doc;
  indexeddb: IndexeddbPersistence;
  provider: HocuspocusProvider;
}

// Scoped by user, not just band — see docs/adr/0006-offline-cache-scoping.md.
// A device shared (or previously used) by someone else must never surface
// this user's cached band content, and vice versa. Logging out deliberately
// leaves this data in place (same user, offline continuation); only an
// explicit "delete local data" action or a server-confirmed non-membership
// clears it.
export function bandIndexedDbName(userId: string, bandId: string): string {
  return `bandstand:${userId}:${bandId}`;
}

/**
 * The explicit "Delete local data" action (Dashboard) — logging out on its
 * own deliberately leaves these caches in place, see
 * docs/adr/0006-offline-cache-scoping.md. Silently does nothing where
 * `indexedDB.databases()` isn't available (notably older Safari): there's
 * no way to enumerate database names without it.
 */
export async function deleteAllLocalBandData(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  const prefix = `bandstand:${userId}:`;
  const databases = await indexedDB.databases();
  await Promise.all(
    databases
      .filter((entry): entry is { name: string } => !!entry.name?.startsWith(prefix))
      .map((entry) => clearDocument(entry.name)),
  );
}

export function connectBandDoc(userId: string, bandId: string, token: string): BandDocConnection {
  const doc = new Y.Doc();
  const indexeddb = new IndexeddbPersistence(bandIndexedDbName(userId, bandId), doc);
  const provider = new HocuspocusProvider({
    url: getActiveServerConfig().hocuspocusUrl,
    name: bandId,
    document: doc,
    token,
  });

  return { doc, indexeddb, provider };
}
