// SPDX-License-Identifier: Apache-2.0
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { authClient } from '../lib/auth-client';
import { connectBandDoc } from '../lib/yjs';

export type BandDocStatus = 'connecting' | 'connected' | 'offline';

export interface UseBandDocResult {
  doc: Y.Doc | null;
  provider: HocuspocusProvider | null;
  status: BandDocStatus;
}

/** Opens (and tears down on unmount/bandId change) the Yjs connection for one band. */
export function useBandDoc(bandId: string | null): UseBandDocResult {
  const { data: session } = authClient.useSession();
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<BandDocStatus>('connecting');

  useEffect(() => {
    const token = session?.session.token;
    if (!bandId || !token) return undefined;

    const connection = connectBandDoc(bandId, token);
    // connectBandDoc's return value is the side effect itself (a new
    // WebSocket + IndexedDB connection) — there's no render-time way to
    // derive it, so exposing it to callers has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoc(connection.doc);
    setProvider(connection.provider);
    connection.provider.on('synced', () => setStatus('connected'));
    connection.provider.on('close', () => setStatus('offline'));

    return () => {
      connection.provider.destroy();
      connection.indexeddb.destroy();
      setDoc(null);
      setProvider(null);
    };
  }, [bandId, session?.session.token]);

  return { doc, provider, status };
}
