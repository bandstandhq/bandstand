// SPDX-License-Identifier: Apache-2.0
//
// Minimal proof of the sync path described in docs/ARCHITECTURE.md: a
// Y.Doc backed by IndexedDB locally (works offline once loaded) and synced
// to the server over Hocuspocus when a connection is available. No actual
// feature (songs/setlists) reads from this doc yet — the Dashboard just
// shows connection status and a live count, to prove the wiring works.
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
