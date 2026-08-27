// SPDX-License-Identifier: Apache-2.0
import {
  can,
  createEvent,
  createPoll,
  createRecurringEvent,
  resolveEventOccurrences,
} from '@bandstand/core';
import type {
  BandRole,
  CalendarEvent,
  EventType,
  Poll,
  ResolvedOccurrence,
  SeriesRule,
  Setlist,
} from '@bandstand/core';
import { Button, Input, Textarea } from '@bandstand/ui';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { useBandDoc } from '../hooks/useBandDoc';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';

type ViewMode = 'list' | 'month';
type RepeatOption = 'none' | 'weekly' | 'biweekly' | 'monthly';

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatEventWhen(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  return event.allDay
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(start)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start);
}

function EventRow({ bandId, occurrence }: { bandId: string; occurrence: ResolvedOccurrence }) {
  const { t } = useTranslation();
  const { event, occurrenceId } = occurrence;
  return (
    <li className="relative flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50">
      <Link
        to={`/bands/${bandId}/calendar/${occurrenceId}`}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t('calendarList.openAria', { name: event.title })}
      />
      <div className="min-w-0">
        <p className="wrap-break-word">
          {event.title}
          {event.status === 'cancelled' && (
            <span className="ml-2 text-muted-foreground">{t('calendarList.cancelledLabel')}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{formatEventWhen(event)}</p>
      </div>
      <span className="shrink-0 text-sm text-primary">{t('calendarList.open')}</span>
    </li>
  );
}

function ListView({ bandId, occurrences }: { bandId: string; occurrences: ResolvedOccurrence[] }) {
  const { t } = useTranslation();
  if (occurrences.length === 0) {
    return <p className="mt-6 text-sm text-muted-foreground">{t('calendarList.noEvents')}</p>;
  }
  return (
    <ul className="mt-6 space-y-2">
      {occurrences.map((occ) => (
        <EventRow key={occ.occurrenceId} bandId={bandId} occurrence={occ} />
      ))}
    </ul>
  );
}

function MonthGrid({
  bandId,
  monthCursor,
  onChangeMonth,
  occurrences,
}: {
  bandId: string;
  monthCursor: Date;
  onChangeMonth: (d: Date) => void;
  occurrences: ResolvedOccurrence[];
}) {
  const { t } = useTranslation();
  const isNarrowScreen = useMediaQuery('(max-width: 639px)');
  const byDate = useMemo(() => {
    const map = new Map<string, ResolvedOccurrence[]>();
    for (const occ of occurrences) {
      const list = map.get(occ.date) ?? [];
      list.push(occ);
      map.set(occ.date, list);
    }
    return map;
  }, [occurrences]);

  const firstOfMonth = startOfMonth(monthCursor);
  const daysInMonth = endOfMonth(monthCursor).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) =>
        new Date(Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth(), i + 1)),
    ),
  ];
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
      new Date(Date.UTC(2026, 1, 1 + i)),
    ),
  );

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChangeMonth(
              new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() - 1, 1)),
            )
          }
        >
          {t('calendarList.previousMonth')}
        </Button>
        <p className="order-first w-full text-center font-medium sm:order-0 sm:w-auto">
          {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
            monthCursor,
          )}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChangeMonth(
              new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1)),
            )
          }
        >
          {t('calendarList.nextMonth')}
        </Button>
      </div>
      {isNarrowScreen ? (
        // Seven columns of appointments don't work on a narrow phone — this
        // month's days-with-events render as an agenda list instead,
        // reusing the same occurrence data. A single conditional render
        // (rather than a `hidden sm:block` / `sm:hidden` pair) so an event
        // title never sits in the DOM twice at once.
        <>
          {occurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('calendarList.noEventsThisMonth')}</p>
          ) : (
            <ul className="space-y-4">
              {[...byDate.keys()].sort().map((dateKey) => (
                <li key={dateKey}>
                  <p className="text-xs font-medium text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    }).format(new Date(`${dateKey}T00:00:00.000Z`))}
                  </p>
                  <ul className="mt-1 space-y-2">
                    {(byDate.get(dateKey) ?? []).map((occ) => (
                      <li
                        key={occ.occurrenceId}
                        className="relative min-h-11 rounded-md border border-border p-2 hover:bg-accent/50"
                      >
                        <Link
                          to={`/bands/${bandId}/calendar/${occ.occurrenceId}`}
                          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          aria-label={t('calendarList.openAria', { name: occ.event.title })}
                        />
                        <span className="wrap-break-word text-sm">{occ.event.title}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {weekdayLabels.map((label) => (
              <div key={label} className="p-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => (
              <div
                key={date ? isoDate(date) : `blank-${i}`}
                className="min-h-24 rounded-md border border-border p-1"
              >
                {date && (
                  <>
                    <p className="text-xs text-muted-foreground">{date.getUTCDate()}</p>
                    <ul className="mt-1 space-y-0.5">
                      {(byDate.get(isoDate(date)) ?? []).map((occ) => (
                        <li
                          key={occ.occurrenceId}
                          className="relative truncate rounded px-1 text-xs hover:bg-accent/50"
                        >
                          <Link
                            to={`/bands/${bandId}/calendar/${occ.occurrenceId}`}
                            className="absolute inset-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            aria-label={t('calendarList.openAria', { name: occ.event.title })}
                          />
                          <span>{occ.event.title}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateEventForm({
  doc,
  setlists,
}: {
  doc: import('yjs').Doc;
  setlists: Record<string, Setlist>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('rehearsal');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [setlistId, setSetlistId] = useState('');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
  const [repeatUntil, setRepeatUntil] = useState('');

  function reset() {
    setTitle('');
    setStartsAt('');
    setEndsAt('');
    setAllDay(false);
    setLocation('');
    setNotes('');
    setSetlistId('');
    setRepeat('none');
    setRepeatUntil('');
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !startsAt) return;
    const startMs = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return;
    const endMs = endsAt
      ? allDay
        ? Date.parse(`${endsAt}T23:59:59.999Z`)
        : new Date(endsAt).getTime()
      : undefined;

    const input = {
      type,
      title: title.trim(),
      startsAt: startMs,
      endsAt: endMs !== undefined && !Number.isNaN(endMs) ? endMs : undefined,
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      setlistId: setlistId || undefined,
      status: 'confirmed' as const,
    };

    if (repeat === 'none') {
      createEvent(doc, input);
    } else {
      const freq: SeriesRule['freq'] =
        repeat === 'weekly' ? 'weekly' : repeat === 'biweekly' ? 'biweekly' : 'monthly';
      createRecurringEvent(doc, input, { freq, until: repeatUntil || undefined });
    }
    reset();
  }

  return (
    <form onSubmit={handleCreate} className="mt-6 space-y-3 rounded-md border border-border p-4">
      <h2 className="font-medium">{t('calendarList.createTitle')}</h2>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('calendarList.titlePlaceholder')}
      />

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
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
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

      <Input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder={t('calendarList.location')}
      />
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t('calendarList.notes')}
      />

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

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.repeats')}
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatOption)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="none">{t('calendarList.repeatNone')}</option>
            <option value="weekly">{t('calendarList.repeatWeekly')}</option>
            <option value="biweekly">{t('calendarList.repeatBiweekly')}</option>
            <option value="monthly">{t('calendarList.repeatMonthly')}</option>
          </select>
        </label>
        {repeat !== 'none' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.repeatUntil')}
            <input
              type="date"
              value={repeatUntil}
              onChange={(e) => setRepeatUntil(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
        )}
      </div>

      <Button type="submit" disabled={!title.trim() || !startsAt}>
        {t('calendarList.create')}
      </Button>
    </form>
  );
}

function PollRow({ bandId, pollId, poll }: { bandId: string; pollId: string; poll: Poll }) {
  const { t } = useTranslation();
  return (
    <li className="relative flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50">
      <Link
        to={`/bands/${bandId}/polls/${pollId}`}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t('calendarList.openPollAria', { name: poll.title })}
      />
      <span className="wrap-break-word">
        {poll.title}
        {poll.resolvedEventId && (
          <span className="ml-2 text-muted-foreground">{t('calendarList.pollClosedLabel')}</span>
        )}
      </span>
      <span className="shrink-0 text-sm text-primary">{t('calendarList.open')}</span>
    </li>
  );
}

function CreatePollForm({ doc }: { doc: import('yjs').Doc }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [optionStarts, setOptionStarts] = useState<string[]>(['']);

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    const options = optionStarts
      .filter((s) => s)
      .map((s) => ({ startsAt: new Date(s).getTime() }))
      .filter((o) => !Number.isNaN(o.startsAt));
    if (!title.trim() || options.length === 0) return;
    createPoll(doc, { title: title.trim(), notes: notes.trim() || undefined, options });
    setTitle('');
    setNotes('');
    setOptionStarts(['']);
  }

  return (
    <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-md border border-border p-4">
      <h2 className="font-medium">{t('calendarList.createPollTitle')}</h2>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('calendarList.pollTitlePlaceholder')}
      />
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t('calendarList.pollNotesPlaceholder')}
      />
      <div className="space-y-2">
        {optionStarts.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={value}
              onChange={(e) =>
                setOptionStarts((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
              }
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            />
            {optionStarts.length > 1 && (
              <button
                type="button"
                onClick={() => setOptionStarts((prev) => prev.filter((_, i) => i !== index))}
                className="text-sm text-muted-foreground hover:underline"
              >
                {t('calendarList.removeOption')}
              </button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOptionStarts((prev) => [...prev, ''])}
        >
          {t('calendarList.addOption')}
        </Button>
      </div>
      <Button type="submit" disabled={!title.trim() || optionStarts.every((s) => !s)}>
        {t('calendarList.createPoll')}
      </Button>
    </form>
  );
}

export function Calendar() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc, status } = useBandDoc(bandId ?? null);
  const events = useYMap<CalendarEvent>(doc?.getMap('events'));
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const polls = useYMap<Poll>(doc?.getMap('polls'));
  const [viewMode, setViewMode] = useState<ViewMode>('list'); // never persisted — always opens in list view
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  // Captured once at mount, not read fresh on every render — Date.now() is
  // an impure call React's render purity rules disallow directly in the
  // component body.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyBands().then((bands) => {
      setViewerRole(bands.find((b) => b.id === bandId)?.role ?? null);
    });
  }, [bandId]);

  const rangeStart = viewMode === 'month' ? startOfMonth(monthCursor).getTime() : now;
  const rangeEnd =
    viewMode === 'month' ? endOfMonth(monthCursor).getTime() : now + 1000 * 60 * 60 * 24 * 180;

  const occurrences = useMemo(
    () => resolveEventOccurrences(events, rangeStart, rangeEnd),
    [events, rangeStart, rangeEnd],
  );
  if (!bandId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;
  const canCreate = viewerRole ? can(viewerRole, 'event:create') : false;
  const canCreatePoll = viewerRole ? can(viewerRole, 'poll:create') : false;
  const pollEntries = Object.entries(polls);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
        &larr; {t('calendarList.back')}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">{t('calendarList.title')}</h1>
        <Button
          type="button"
          variant="outline"
          onClick={() => setViewMode(viewMode === 'month' ? 'list' : 'month')}
        >
          {viewMode === 'month' ? t('calendarList.listView') : t('calendarList.monthView')}
        </Button>
      </div>

      {viewMode === 'month' ? (
        <MonthGrid
          bandId={bandId}
          monthCursor={monthCursor}
          onChangeMonth={setMonthCursor}
          occurrences={occurrences}
        />
      ) : (
        <ListView bandId={bandId} occurrences={occurrences} />
      )}

      {canCreate && doc && <CreateEventForm doc={doc} setlists={setlists} />}

      <div className="mt-8">
        <h2 className="text-lg font-medium">{t('calendarList.pollsTitle')}</h2>
        {pollEntries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('calendarList.noPolls')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pollEntries.map(([pollId, poll]) => (
              <PollRow key={pollId} bandId={bandId} pollId={pollId} poll={poll} />
            ))}
          </ul>
        )}
        {canCreatePoll && doc && <CreatePollForm doc={doc} />}
      </div>
    </main>
  );
}
