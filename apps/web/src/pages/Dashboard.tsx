// SPDX-License-Identifier: Apache-2.0
import { Button } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { BandSwitcher } from '../components/BandSwitcher';
import { authClient } from '../lib/auth-client';
import { connectBandDoc } from '../lib/yjs';
import { useActiveBandStore } from '../stores/activeBand';

export function Dashboard() {
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [songCount, setSongCount] = useState(0);

  useEffect(() => {
    if (!session?.session.token || !activeBandId) return undefined;

    const connection = connectBandDoc(activeBandId, session.session.token);
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
  }, [session?.session.token, activeBandId]);

  if (!isPending && !session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-3">
          <BandSwitcher />
          <Button variant="outline" onClick={() => authClient.signOut()}>
            {t('dashboard.logout')}
          </Button>
        </div>
      </div>
      {activeBandId ? (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {status === 'connected'
              ? t('dashboard.connected')
              : status === 'offline'
                ? t('dashboard.offline')
                : t('dashboard.connecting')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.songCount', { count: songCount })}</p>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('dashboard.noBandSelected')}</p>
      )}
    </main>
  );
}
