// SPDX-License-Identifier: Apache-2.0
import { type AvailabilityAnswer, type CalendarEvent, type Poll, resolveEventOccurrences } from '@bandstand/core';
import { Button, useConfirmDialog } from '@bandstand/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { EventStatusSuffix } from '../components/EventStatusSuffix';
import { OfflineReadiness } from '../components/OfflineReadiness';
import { PushNotificationsPanel } from '../components/PushNotificationsPanel';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import { getActiveServerConfig } from '../lib/serverConfig';

const UPCOMING_WINDOW_MS = 1000 * 60 * 60 * 24 * 180;

function formatEventWhen(event: CalendarEvent, locale: string): string {
  const start = new Date(event.startsAt);
  return event.allDay
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(start)
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(start);
}

function UpcomingEvents({ bandId, doc, currentUserId }: { bandId: string; doc: import('yjs').Doc; currentUserId: string }) {
  const { t, i18n } = useTranslation();
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
              className="relative flex items-center justify-between gap-3 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50"
            >
              <Link
                to={`/bands/${bandId}/calendar/${occ.occurrenceId}`}
                className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t('dashboard.openEventAria', { name: occ.event.title })}
              />
              <div className="min-w-0">
                <p className="wrap-break-word">
                  {occ.event.title}
                  <EventStatusSuffix status={occ.event.status} />
                </p>
                <p className="text-xs text-muted-foreground">{formatEventWhen(occ.event, i18n.language)}</p>
              </div>
              {!hasAnswered && (
                <span className="shrink-0 text-xs text-primary">{t('dashboard.needsResponse')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every open (not yet closed into an event) poll the current user hasn't voted in at all — voting on any one option is enough to drop off this list, even if the poll itself stays open for others. */
function OpenPolls({ bandId, doc, currentUserId }: { bandId: string; doc: import('yjs').Doc; currentUserId: string }) {
  const { t } = useTranslation();
  const polls = useYMap<Poll>(doc.getMap('polls'));
  const pollVotes = useYMap<AvailabilityAnswer>(doc.getMap('pollVotes'));

  const unvoted = useMemo(
    () =>
      Object.entries(polls).filter(
        ([pollId, poll]) =>
          !poll.resolvedEventId &&
          !poll.options.some((option) => pollVotes[`${pollId}:${option.id}:${currentUserId}`] !== undefined),
      ),
    [polls, pollVotes, currentUserId],
  );

  if (unvoted.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-muted-foreground">{t('dashboard.openPollsTitle')}</h2>
      <ul className="mt-2 space-y-2">
        {unvoted.map(([pollId, poll]) => (
          <li
            key={pollId}
            className="relative flex items-center justify-between gap-3 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50"
          >
            <Link
              to={`/bands/${bandId}/polls/${pollId}`}
              className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={t('dashboard.openPollAria', { name: poll.title })}
            />
            <p className="min-w-0 wrap-break-word">{poll.title}</p>
            <span className="shrink-0 text-xs text-primary">{t('dashboard.needsResponse')}</span>
          </li>
        ))}
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
export function CalendarSubscribePanel() {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [token, setToken] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiClient.getIcsToken().then((r) => setToken(r.token));
  }, []);

  async function handleRegenerate() {
    const confirmed = await confirm({
      title: t('dashboard.icsRegenerateConfirm'),
      confirmLabel: t('dashboard.icsRegenerate'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
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
  const url = `${getActiveServerConfig().serverUrl}/calendar/${token}.ics`;

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

/**
 * Only ever mounted at /bands/:bandId/dashboard (see routes/bandRoutes.ts)
 * — bandId comes from the route like every other band-scoped page, never
 * from global state. The bare /dashboard route (DashboardRedirect.tsx)
 * resolves which band to send you to first; this component doesn't handle
 * "no band" itself, DashboardRedirect's own empty state does.
 */
export function Dashboard() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { data: session } = authClient.useSession();
  const { doc, status } = useBandDoc(bandId ?? null);
  const songs = useYMap(doc?.getMap('songs'));

  // No anonymous check here — RequireAuth (router.tsx) already guarantees a
  // session before this component ever mounts.
  if (status === 'forbidden') {
    return <BandAccessDenied />;
  }

  return (
    <PageShell title={t('dashboard.title')}>
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
      {doc && bandId && <OfflineReadiness bandId={bandId} doc={doc} />}
      {doc && bandId && session && <UpcomingEvents bandId={bandId} doc={doc} currentUserId={session.user.id} />}
      {doc && bandId && session && <OpenPolls bandId={bandId} doc={doc} currentUserId={session.user.id} />}
      <CalendarSubscribePanel />
      <PushNotificationsPanel />
    </PageShell>
  );
}
