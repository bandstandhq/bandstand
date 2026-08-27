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
import { BandAccessDenied } from '../components/BandAccessDenied';
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

function formatEventWhen(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  const startText = event.allDay
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(start)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(start);
  if (!event.endsAt) return startText;
  const end = new Date(event.endsAt);
  const endText = event.allDay
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(end)
    : new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(end);
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
    <li className="flex items-center justify-between rounded-md border border-border p-2">
      <span>{member.name}</span>
      {isSelf && onRespond ? (
        <div className="flex gap-1">
          {ANSWERS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={answer === option ? 'default' : 'outline'}
              onClick={() => onRespond(option)}
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
  const { t } = useTranslation();
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
      <main className="min-h-screen bg-background p-6 text-foreground">
        <Link to={`/bands/${bandId}/calendar`} className="text-sm text-muted-foreground hover:underline">
          &larr; {t('eventDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t('eventDetail.notFound')}</p>
      </main>
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
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to={`/bands/${bandId}/calendar`} className="text-sm text-muted-foreground hover:underline">
        &larr; {t('eventDetail.back')}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">{event.title}</h1>
        <div className="flex gap-2 text-xs">
          {event.status === 'cancelled' && <span className="rounded bg-muted px-2 py-1">{t('eventDetail.cancelledBadge')}</span>}
          {event.status === 'tentative' && <span className="rounded bg-muted px-2 py-1">{t('eventDetail.tentativeBadge')}</span>}
          {event.allDay && <span className="rounded bg-muted px-2 py-1">{t('eventDetail.allDayBadge')}</span>}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{formatEventWhen(event)}</p>

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
          <p className="relative text-sm font-medium text-muted-foreground">{t('eventDetail.linkedSetlist')}</p>
          <p className="relative">{linkedSetlist.name}</p>
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
              className="text-sm text-destructive hover:underline disabled:opacity-50"
            >
              {deleting ? t('eventDetail.deleting') : t('eventDetail.delete')}
            </button>
          )}
          {canDelete && event.seriesId && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteSeries()}
              className="text-sm text-destructive hover:underline disabled:opacity-50"
            >
              {t('eventDetail.deleteSeries')}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
