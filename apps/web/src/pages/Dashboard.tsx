// SPDX-License-Identifier: Apache-2.0
import { type AvailabilityAnswer, type CalendarEvent, resolveEventOccurrences } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { BandSwitcher } from '../components/BandSwitcher';
import { OfflineReadiness } from '../components/OfflineReadiness';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient, getDefaultServerUrl } from '../lib/auth-client';
import { deleteAllLocalBandData } from '../lib/yjs';
import { useActiveBandStore } from '../stores/activeBand';

const UPCOMING_WINDOW_MS = 1000 * 60 * 60 * 24 * 180;

function formatEventWhen(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  return event.allDay
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(start)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start);
}

function UpcomingEvents({ bandId, doc, currentUserId }: { bandId: string; doc: import('yjs').Doc; currentUserId: string }) {
  const { t } = useTranslation();
  const events = useYMap<CalendarEvent>(doc.getMap('events'));
  const availability = useYMap<AvailabilityAnswer>(doc.getMap('availability'));
  const [now] = useState(() => Date.now());

  const upcoming = useMemo(
    () => resolveEventOccurrences(events, now, now + UPCOMING_WINDOW_MS).slice(0, 3),
    [events, now],
  );

  if (upcoming.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-muted-foreground">{t('dashboard.upcomingTitle')}</h2>
      <ul className="mt-2 space-y-2">
        {upcoming.map((occ) => {
          const hasAnswered = availability[`${occ.occurrenceId}:${currentUserId}`] !== undefined;
          return (
            <li
              key={occ.occurrenceId}
              className="relative flex items-center justify-between rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50"
            >
              <Link
                to={`/bands/${bandId}/calendar/${occ.occurrenceId}`}
                className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t('dashboard.openEventAria', { name: occ.event.title })}
              />
              <div>
                <p>{occ.event.title}</p>
                <p className="text-xs text-muted-foreground">{formatEventWhen(occ.event)}</p>
              </div>
              {!hasAnswered && <span className="text-xs text-primary">{t('dashboard.needsResponse')}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Personal, not band-scoped — spans every band the signed-in user is in,
 * regardless of which one is currently active. See
 * docs/adr/0011-calendar-events.md for why membership is rechecked fresh on
 * every fetch of the feed itself rather than trusted from this token.
 */
function CalendarSubscribePanel() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiClient.getIcsToken().then((r) => setToken(r.token));
  }, []);

  async function handleRegenerate() {
    if (!window.confirm(t('dashboard.icsRegenerateConfirm'))) return;
    setRegenerating(true);
    try {
      const { token: newToken } = await apiClient.regenerateIcsToken();
      setToken(newToken);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by browser permission policy — the
      // URL is still visible and selectable, so this isn't fatal.
    }
  }

  if (!token) return null;
  const url = `${getDefaultServerUrl()}/calendar/${token}.ics`;

  return (
    <div className="mt-8 rounded-md border border-border p-4">
      <h2 className="font-medium">{t('dashboard.icsTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.icsDescription')}</p>
      <p className="mt-2 break-all rounded bg-muted p-2 text-xs">{url}</p>
      <p className="mt-2 text-xs text-destructive">{t('dashboard.icsWarning')}</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy(url)}>
          {copied ? t('dashboard.icsCopied') : t('dashboard.icsCopy')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={regenerating} onClick={() => void handleRegenerate()}>
          {regenerating ? t('dashboard.icsRegenerating') : t('dashboard.icsRegenerate')}
        </Button>
      </div>
    </div>
  );
}

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
              <Link to={`/bands/${activeBandId}/calendar`}>
                <Button variant="ghost">{t('dashboard.calendar')}</Button>
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
          {doc && session && <UpcomingEvents bandId={activeBandId} doc={doc} currentUserId={session.user.id} />}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('dashboard.noBandSelected')}</p>
      )}
      <CalendarSubscribePanel />
    </main>
  );
}
