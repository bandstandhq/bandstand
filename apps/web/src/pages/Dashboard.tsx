// SPDX-License-Identifier: Apache-2.0
import { Button } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { authClient } from '../lib/auth-client';
import { connectBandDoc } from '../lib/yjs';

// No band-selection UI exists yet (that's Phase 1 Repertoire/Setlist work) —
// this placeholder document just proves the Y.Doc <-> Hocuspocus <-> Postgres
// path from docs/ARCHITECTURE.md actually works end-to-end. Must be a real
// uuid shape: band_docs.band_id is a uuid column, and a non-uuid document
// name makes every Hocuspocus load/store query fail outright.
const PLACEHOLDER_BAND_ID = '00000000-0000-0000-0000-000000000000';

export function Dashboard() {
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [songCount, setSongCount] = useState(0);

  useEffect(() => {
    if (!session?.session.token) return undefined;

    const connection = connectBandDoc(PLACEHOLDER_BAND_ID, session.session.token);
    const { doc, provider } = connection;
    const songs = doc.getMap('songs');

    const updateCount = () => setSongCount(songs.size);
    songs.observe(updateCount);
    updateCount();

    provider.on('synced', () => setStatus('connected'));
    provider.on('close', () => setStatus('offline'));

    return () => {
      songs.unobserve(updateCount);
      connection.provider.destroy();
      connection.indexeddb.destroy();
    };
  }, [session?.session.token]);

  if (!isPending && !session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('dashboard.title')}</h1>
        <Button variant="outline" onClick={() => authClient.signOut()}>
          {t('dashboard.logout')}
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {status === 'connected' ? t('dashboard.connected') : status === 'offline' ? t('dashboard.offline') : t('dashboard.connecting')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.songCount', { count: songCount })}</p>
    </main>
  );
}
