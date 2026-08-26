// SPDX-License-Identifier: Apache-2.0
import { Button } from '@bandstand/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { BandSwitcher } from '../components/BandSwitcher';
import { OfflineReadiness } from '../components/OfflineReadiness';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { authClient } from '../lib/auth-client';
import { deleteAllLocalBandData } from '../lib/yjs';
import { useActiveBandStore } from '../stores/activeBand';

export function Dashboard() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const activeBandId = useActiveBandStore((s) => s.activeBandId);
  const { doc, status } = useBandDoc(activeBandId);
  const songs = useYMap(doc?.getMap('songs'));

  // No anonymous check here — RequireAuth (router.tsx) already guarantees a
  // session before this component ever mounts.
  if (status === 'forbidden') {
    return <BandAccessDenied />;
  }

  async function handleDeleteLocalData() {
    if (!session) return;
    if (!window.confirm(t('dashboard.deleteLocalDataConfirm'))) return;
    await deleteAllLocalBandData(session.user.id);
    window.alert(t('dashboard.deleteLocalDataDone'));
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-3">
          <BandSwitcher />
          {activeBandId && (
            <>
              <Link to={`/bands/${activeBandId}/repertoire`}>
                <Button variant="ghost">{t('dashboard.repertoire')}</Button>
              </Link>
              <Link to={`/bands/${activeBandId}/setlists`}>
                <Button variant="ghost">{t('dashboard.setlists')}</Button>
              </Link>
              <Link to={`/bands/${activeBandId}/settings`}>
                <Button variant="ghost">{t('dashboard.bandSettings')}</Button>
              </Link>
            </>
          )}
          <Button variant="ghost" onClick={handleDeleteLocalData}>
            {t('dashboard.deleteLocalData')}
          </Button>
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
          <p className="mt-1 text-sm text-muted-foreground">
            {t('dashboard.songCount', { count: Object.keys(songs).length })}
          </p>
          {doc && <OfflineReadiness bandId={activeBandId} doc={doc} />}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('dashboard.noBandSelected')}</p>
      )}
    </main>
  );
}
