// SPDX-License-Identifier: Apache-2.0
import {
  type AvailabilityAnswer,
  type BandMember,
  type BandRole,
  buildLocationHref,
  can,
  type CalendarEvent,
  type EventStatus,
  type EventType,
  findOccurrenceEvent,
  respondAvailability,
  type Setlist,
  updateOccurrence,
} from '@bandstand/core';
import { Button, Dialog, Input, Textarea } from '@bandstand/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { EventStatusSuffix } from '../components/EventStatusSuffix';
import { PencilIcon, TrashIcon } from '../components/icons';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

// The single trash button permanently deletes only within this window after
// the event was created (never after an edit — createdAt is set once and
// never touched again, see the schema's own comment); past it, or for an
// event that was never actually created for real yet (a virtual, unmaterialized
// occurrence), the same button cancels instead.
const DELETE_GRACE_PERIOD_MS = 5 * 60 * 1000;

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

// The inverse of CreateEventForm's own (Calendar.tsx) parsing: a
// datetime-local input's value is local time with no offset, so this uses
// local getters, not toISOString (UTC) — an all-day date, on the other hand,
// is parsed there as UTC midnight, so formatting it back with toISOString's
// UTC date portion is the correct inverse for that one, not a shortcut.
function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const EVENT_STATUS_LABEL_KEY: Record<EventStatus, string> = {
  confirmed: 'eventDetail.statusConfirmed',
  tentative: 'eventDetail.statusTentative',
  cancelled: 'eventDetail.statusCancelled',
};

/**
 * Edits whichever occurrence is currently open, via `updateOccurrence` —
 * never the series' recurrence rule itself (repeat/until), which stays a
 * create-time-only decision here; changing an existing series' own
 * recurrence is out of scope for this form.
 */
function EditEventForm({
  doc,
  event,
  occurrenceId,
  setlists,
  onSaved,
}: {
  doc: import('yjs').Doc;
  event: CalendarEvent;
  occurrenceId: string;
  setlists: Record<string, Setlist>;
  onSaved: (savedOccurrenceId: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(event.title);
  const [type, setType] = useState<EventType>(event.type);
  const [allDay, setAllDay] = useState(event.allDay);
  const [startsAt, setStartsAt] = useState(
    event.allDay ? toDateValue(event.startsAt) : toDateTimeLocalValue(event.startsAt),
  );
  const [endsAt, setEndsAt] = useState(
    event.endsAt === undefined ? '' : event.allDay ? toDateValue(event.endsAt) : toDateTimeLocalValue(event.endsAt),
  );
  const [location, setLocation] = useState(event.location ?? '');
  const [notes, setNotes] = useState(event.notes ?? '');
  const [setlistId, setSetlistId] = useState(event.setlistId ?? '');
  const [status, setStatus] = useState<EventStatus>(event.status);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startsAt) return;
    const startMs = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return;
    const endMs = endsAt
      ? allDay
        ? Date.parse(`${endsAt}T23:59:59.999Z`)
        : new Date(endsAt).getTime()
      : undefined;

    const savedOccurrenceId = updateOccurrence(doc, occurrenceId, {
      type,
      title: title.trim(),
      startsAt: startMs,
      endsAt: endMs !== undefined && !Number.isNaN(endMs) ? endMs : undefined,
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      setlistId: setlistId || undefined,
      status,
    });
    onSaved(savedOccurrenceId);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('calendarList.titlePlaceholder')} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.type')}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="gig">{t('calendarList.typeGig')}</option>
            <option value="rehearsal">{t('calendarList.typeRehearsal')}</option>
            <option value="other">{t('calendarList.typeOther')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('eventDetail.status')}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            {(Object.keys(EVENT_STATUS_LABEL_KEY) as EventStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(EVENT_STATUS_LABEL_KEY[s])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              const nextAllDay = e.target.checked;
              setAllDay(nextAllDay);
              // Switching representations mid-edit would otherwise carry a
              // stale local-time or UTC-midnight value across into the
              // other input type — re-derive both from the same instant.
              const startMs = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
              if (!Number.isNaN(startMs)) setStartsAt(nextAllDay ? toDateValue(startMs) : toDateTimeLocalValue(startMs));
              if (endsAt) {
                const endMs = allDay ? Date.parse(`${endsAt}T23:59:59.999Z`) : new Date(endsAt).getTime();
                if (!Number.isNaN(endMs)) setEndsAt(nextAllDay ? toDateValue(endMs) : toDateTimeLocalValue(endMs));
              }
            }}
          />
          {t('calendarList.allDay')}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.startsAt')}
          <input
            type={allDay ? 'date' : 'datetime-local'}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.endsAt')}
          <input
            type={allDay ? 'date' : 'datetime-local'}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
      </div>

      <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('calendarList.location')} />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('calendarList.notes')} />

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('calendarList.linkedSetlist')}
        <select
          value={setlistId}
          onChange={(e) => setSetlistId(e.target.value)}
          className="h-10 max-w-48 truncate rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">{t('calendarList.noSetlist')}</option>
          {Object.entries(setlists).map(([id, setlist]) => (
            <option key={id} value={id}>
              {setlist.name}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" disabled={!title.trim() || !startsAt}>
        {t('eventDetail.saveChanges')}
      </Button>
    </form>
  );
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
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const [members, setMembers] = useState<BandMember[]>([]);
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Captured once at mount, not read fresh on every render — Date.now() is
  // an impure call React's render purity rules disallow directly in the
  // component body (same reasoning as Calendar.tsx's own `now` state); the
  // five-minute grace period below doesn't need tighter precision than that.
  const [now] = useState(() => Date.now());
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
  const canPermanentlyDelete =
    !isVirtualOccurrence && event.createdAt !== undefined && now - event.createdAt < DELETE_GRACE_PERIOD_MS;
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

  function handleCancel() {
    if (!doc || !occurrenceId || !event || !bandId) return;
    const confirmMessage = event.seriesId
      ? t('eventDetail.confirmCancelOccurrence', { name: event.title })
      : t('eventDetail.confirmCancel', { name: event.title });
    if (!window.confirm(confirmMessage)) return;
    // updateOccurrence already handles a real entry (plain event, template,
    // or existing exception) vs. a virtual occurrence needing a fresh
    // exception materialized for it — same logic, one call either way. A
    // virtual occurrence's cancellation lands under a brand-new real id, so
    // this page — still showing the old synthetic one — has to follow it
    // there, same reasoning as the edit dialog's own onSaved above.
    const savedOccurrenceId = updateOccurrence(doc, occurrenceId, { status: 'cancelled' });
    if (savedOccurrenceId !== occurrenceId) {
      navigate(`/bands/${bandId}/calendar/${savedOccurrenceId}`, { replace: true });
    }
  }

  function handleTrashClick() {
    if (canPermanentlyDelete) {
      void handleDelete();
    } else {
      handleCancel();
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
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditDialogOpen(true)}
              aria-label={t('eventDetail.edit')}
              title={t('eventDetail.edit')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <PencilIcon className="h-5 w-5" />
            </button>
          )}
          {canDelete && (
            // One button, two behaviors depending on age: within
            // DELETE_GRACE_PERIOD_MS of creation (never of a later edit) it
            // deletes for good, same as a fresh mistake being undone; after
            // that — or for a virtual occurrence, which has no real entry
            // yet to delete — it cancels instead.
            <button
              type="button"
              disabled={deleting}
              onClick={handleTrashClick}
              aria-label={
                canPermanentlyDelete ? (deleting ? t('eventDetail.deleting') : t('eventDetail.delete')) : t('eventDetail.cancel')
              }
              title={
                canPermanentlyDelete ? (deleting ? t('eventDetail.deleting') : t('eventDetail.delete')) : t('eventDetail.cancel')
              }
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

      {canEdit && doc && (
        <Dialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          title={t('eventDetail.editTitle')}
          closeLabel={t('common.close')}
        >
          <EditEventForm
            doc={doc}
            event={event}
            occurrenceId={occurrenceId}
            setlists={setlists}
            onSaved={(savedOccurrenceId) => {
              setEditDialogOpen(false);
              // Editing a virtual occurrence materializes a fresh exception
              // under its own real id, never the synthetic templateId@date
              // one this page is currently showing — stay there and the
              // page would resolve to "not found" the moment `events`
              // updates, since that synthetic id no longer maps to anything.
              if (savedOccurrenceId !== occurrenceId && bandId) {
                navigate(`/bands/${bandId}/calendar/${savedOccurrenceId}`, { replace: true });
              }
            }}
          />
        </Dialog>
      )}
    </PageShell>
  );
}
