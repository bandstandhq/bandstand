// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only place server code mutates a band's live Yjs document outside of
// a real client connection — see docs/adr/0005-permissions.md. Hocuspocus's
// openDirectConnection loads the persisted document (through the same
// Database extension a real client's sync would), runs the mutation as a
// `{ source: 'local' }`-tagged transaction (see hocuspocus.ts's guard,
// which relies on that tag to tell this apart from a client's own write),
// and disconnecting it triggers the existing store hook, so connected
// clients receive the change through ordinary sync.
import type * as Y from 'yjs';
import { hocuspocusServer } from './hocuspocus';

export async function withBandDoc<T>(bandId: string, mutate: (doc: Y.Doc) => T): Promise<T> {
  const connection = await hocuspocusServer.hocuspocus.openDirectConnection(bandId, { isServerAction: true });
  try {
    let result!: T;
    await connection.transact((doc) => {
      result = mutate(doc);
    });
    return result;
  } finally {
    await connection.disconnect();
  }
}
