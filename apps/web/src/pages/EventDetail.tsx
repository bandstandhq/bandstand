// SPDX-License-Identifier: Apache-2.0
import {
  type AvailabilityAnswer,
  type BandMember,
  type BandRole,
  buildLocationHref,
  cancelOccurrence,
  can,
  type CalendarEvent,
  findOccurrenceEvent,
  respondAvailability,
  updateEvent,
} from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { EventStatusSuffix } from '../components/EventStatusSuffix';
import { TrashIcon } from '../components/icons';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

const ANSWERS: AvailabilityAnswer[] = ['yes', 'maybe', 'no'];
const ANSWER_LABEL_KEY: Record<AvailabilityAnswer, string> = {
  yes: 'eventDetail.answerYes',
  maybe: 'eventDetail.answerMaybe',
  no: 'eventDetail.answerNo',
};

function formatEventWhen(event: CalendarEvent, locale: string): string {
  const start = new Date(event.startsAt);
  const startText = event.allDay
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(start)
    : new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(start);
  if (!event.endsAt) return startText;
  const end = new Date(event.endsAt);
  const endText = event.allDay
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(end)
    : new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(end);
  return `${startText} – ${endText}`;
}

function AvailabilityRow({
  member,
  answer,
  isSelf,
  onRespond,
}: {
  member: BandMember;
  answer: AvailabilityAnswer | undefined;
  isSelf: boolean;
  onRespond?: (answer: AvailabilityAnswer) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="wrap-break-word">{member.name}</span>
      {isSelf && onRespond ? (
        <div className="flex flex-wrap gap-1">
          {ANSWERS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={answer === option ? 'default' : 'outline'}
              onClick={() => onRespond(option)}
              className="h-11 min-w-11"
            >
              {t(ANSWER_LABEL_KEY[option])}
            </Button>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{answer ? t(ANSWER_LABEL_KEY[answer]) : t('eventDetail.stillOpen')}</span>
      )}
    </li>
  );
}

export function EventDetail() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { bandId, occurrenceId } = useParams<{ bandId: string; occurrenceId: string }>();
  const { data: session } = authClient.useSession();
  const { doc, status } = useBandDoc(bandId ?? null);
  const events = useYMap<CalendarEvent>(doc?.getMap('events'));
  const availability = useYMap<AvailabilityAnswer>(doc?.getMap('availability'));
  const [members, setMembers] = useState<BandMember[]>([]);
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listBandMembers(bandId).then(setMembers);
    apiClient.listMyBands().then((bands) => setViewerRole(bands.find((b) => b.id === bandId)?.role ?? null));
  }, [bandId]);

  if (!bandId || !occurrenceId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;

  const event = findOccurrenceEvent(events, occurrenceId);
  if (!event) {
    return (
      <PageShell title={t('eventDetail.notFound')}>
        <Link to={`/bands/${bandId}/calendar`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
          &larr; {t('eventDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t('eventDetail.notFound')}</p>
      </PageShell>
    );
  }

  const canEdit = viewerRole ? can(viewerRole, 'event:edit') : false;
  const canDelete = viewerRole ? can(viewerRole, 'event:delete') : false;
  const currentUserId = session?.user.id;
  // A virtual (never-materialized) occurrence has no real `events` entry of
  // its own — only its template does. Everything else (a plain event, or a
  // real series exception) has a real entry under `occurrenceId` itself.
  const isVirtualOccurrence = !events[occurrenceId];
  const linkedSetlist = event.setlistId ? doc?.getMap('setlists').get(event.setlistId) as { name: string } | undefined : undefined;
  const locationHref = event.location ? buildLocationHref(event.location, event.locationGeo) : undefined;

  function handleRespond(answer: AvailabilityAnswer) {
    if (!doc || !currentUserId || !occurrenceId) return;
    respondAvailability(doc, occurrenceId, currentUserId, answer);
  }

  async function handleDelete() {
    if (!bandId || !occurrenceId || !event) return;
    if (!window.confirm(t('eventDetail.confirmDelete', { name: event.title }))) return;
    setDeleting(true);
    try {
      await apiClient.deleteEvent(bandId, occurrenceId);
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  async function handleDeleteSeries() {
    if (!bandId || !event?.seriesId) return;
    if (!window.confirm(t('eventDetail.confirmDeleteSeries', { name: event.title }))) return;
    setDeleting(true);
    try {
      await apiClient.deleteEvent(bandId, event.seriesId, 'series');
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  function handleCancelOccurrence() {
    if (!doc || !event?.seriesId || !occurrenceId) return;
    if (!window.confirm(t('eventDetail.confirmCancelOccurrence', { name: event.title }))) return;
    // A real entry (an existing exception, or — rare, but possible — the
    // template's own row if it's the first occurrence) is edited in place;
    // a virtual occurrence has nothing to edit yet, so a new exception is
    // created for it instead. Never both, to avoid two exceptions for the
    // same (seriesId, occurrenceDate).
    if (isVirtualOccurrence) {
      const date = occurrenceId.slice(occurrenceId.lastIndexOf('@') + 1);
      cancelOccurrence(doc, event.seriesId, date);
    } else {
      updateEvent(doc, occurrenceId, { status: 'cancelled' });
    }
  }

  return (
    <PageShell
      title={
        <>
          {event.title}
          <EventStatusSuffix status={event.status} />
        </>
      }
    >
      <Link to={`/bands/${bandId}/calendar`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('eventDetail.back')}
      </Link>

      {event.allDay && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-muted px-2 py-1">{t('eventDetail.allDayBadge')}</span>
          </div>
        </div>
      )}

      <p className="mt-2 text-sm text-muted-foreground">{formatEventWhen(event, i18n.language)}</p>

      {event.location && (
        <p className="mt-2 text-sm">
          {locationHref ? (
            <a href={locationHref} className="text-primary hover:underline" aria-label={t('eventDetail.openLocationAria')}>
              {event.location}
            </a>
          ) : (
            event.location
          )}
        </p>
      )}

      {event.notes && (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-muted-foreground">{t('eventDetail.notes')}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{event.notes}</p>
        </div>
      )}

      {linkedSetlist && (
        <div className="relative mt-4 rounded-md border border-border p-3 hover:bg-accent/50">
          <Link
            to={`/bands/${bandId}/setlists/${event.setlistId}`}
            className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label={t('eventDetail.openSetlistAria', { name: linkedSetlist.name })}
          />
          {/* Plain text, not independently interactive — no `relative`, so
              the absolutely-positioned link above stays on top and
              clickable through it. */}
          <p className="text-sm font-medium text-muted-foreground">{t('eventDetail.linkedSetlist')}</p>
          <p>{linkedSetlist.name}</p>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-muted-foreground">{t('eventDetail.availabilityTitle')}</h2>
        <ul className="mt-2 space-y-1">
          {members.map((member) => (
            <AvailabilityRow
              key={member.userId}
              member={member}
              answer={availability[`${occurrenceId}:${member.userId}`]}
              isSelf={member.userId === currentUserId}
              onRespond={member.userId === currentUserId ? handleRespond : undefined}
            />
          ))}
        </ul>
      </div>

      {(canEdit || canDelete) && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {canEdit && event.seriesId && (
            <button
              type="button"
              onClick={handleCancelOccurrence}
              className="text-sm text-muted-foreground hover:underline"
            >
              {t('eventDetail.cancelOccurrence')}
            </button>
          )}
          {canDelete && !isVirtualOccurrence && (
            // A virtual occurrence has no real entry of its own to delete —
            // only "cancel this date" (creates one) or delete the series
            // apply to it.
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDelete()}
              aria-label={deleting ? t('eventDetail.deleting') : t('eventDetail.delete')}
              title={deleting ? t('eventDetail.deleting') : t('eventDetail.delete')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          )}
          {canDelete && event.seriesId && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteSeries()}
              aria-label={t('eventDetail.deleteSeries')}
              title={t('eventDetail.deleteSeries')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
    </PageShell>
  );
}
