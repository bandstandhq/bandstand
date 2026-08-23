// SPDX-License-Identifier: Apache-2.0
//
// The sync path described in docs/ARCHITECTURE.md: a Y.Doc backed by
// IndexedDB locally (works offline once loaded) and synced to the server
// over Hocuspocus when a connection is available. See hooks/useBandDoc.ts
// for the React-facing wrapper feature pages actually use.
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

export interface BandDocConnection {
  doc: Y.Doc;
  indexeddb: IndexeddbPersistence;
  provider: HocuspocusProvider;
}

// The sync server URL is configurable per account/device, same as the REST
// API's — this is only the build-time default (see docs/ARCHITECTURE.md).
function getDefaultHocuspocusUrl(): string {
  return import.meta.env.VITE_DEFAULT_HOCUSPOCUS_URL ?? 'ws://localhost:3002';
}

export function connectBandDoc(bandId: string, token: string): BandDocConnection {
  const doc = new Y.Doc();
  const indexeddb = new IndexeddbPersistence(bandId, doc);
  const provider = new HocuspocusProvider({
    url: getDefaultHocuspocusUrl(),
    name: bandId,
    document: doc,
    token,
  });

  return { doc, indexeddb, provider };
}
