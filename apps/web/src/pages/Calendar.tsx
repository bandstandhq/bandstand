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
  Setlist,
} from '@bandstand/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@bandstand/ui';
import { BarChart3, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { type FormEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { EventStatusSuffix } from '../components/EventStatusSuffix';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { useBandDoc } from '../hooks/useBandDoc';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';

type ViewMode = 'list' | 'month';
// Every non-'none' value matches a real SeriesRule['freq'] 1:1 (see
// trySave below) — 'monthly' (legacy, variable weekday) is deliberately not
// offered here, only 'monthlyByWeekday' (see docs/adr/0011-calendar-events.md).
type RepeatOption = 'none' | 'weekly' | 'biweekly' | 'every4weeks' | 'monthlyByWeekday';

// Radix Select reserves the empty string for "no selection" internally —
// the old native <option value=""> for "no linked setlist" needs its own
// sentinel instead.
const NO_SETLIST = '__none__';

const ORDINAL_LABEL_KEY = [
  'calendarList.ordinalFirst',
  'calendarList.ordinalSecond',
  'calendarList.ordinalThird',
  'calendarList.ordinalFourth',
] as const;

/**
 * "the first Monday" / "am ersten Montag" — the pattern a `monthlyByWeekday`
 * series would repeat on, derived from whatever start date/time is
 * currently in the form (not yet a real event, so there's no CalendarEvent
 * to hand to eventSeries.ts's own math — this mirrors it just closely
 * enough for the hint text). Undefined until a start date is actually
 * chosen, or on an unparseable one.
 */
function describeMonthlyByWeekdayPattern(
  startsAt: string,
  allDay: boolean,
  locale: string,
  t: (key: string) => string,
): string | undefined {
  if (!startsAt) return undefined;
  const ms = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  const day = allDay ? d.getUTCDate() : d.getDate();
  const ordinalIndex = Math.min(Math.ceil(day / 7), 4) - 1;
  const weekdayLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: allDay ? 'UTC' : undefined,
  }).format(d);
  return `${t(ORDINAL_LABEL_KEY[ordinalIndex]!)} ${weekdayLabel}`;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatEventWhen(event: CalendarEvent, locale: string): string {
  const start = new Date(event.startsAt);
  return event.allDay
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(start)
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(start);
}

function EventRow({ bandId, occurrence }: { bandId: string; occurrence: ResolvedOccurrence }) {
  const { t, i18n } = useTranslation();
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
          <EventStatusSuffix status={event.status} />
        </p>
        <p className="text-xs text-muted-foreground">{formatEventWhen(event, i18n.language)}</p>
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
  const { t, i18n } = useTranslation();
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
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
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
          {new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(
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
                    {new Intl.DateTimeFormat(i18n.language, {
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
                        <span className="wrap-break-word text-sm">
                          {occ.event.title}
                          <EventStatusSuffix status={occ.event.status} />
                        </span>
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
                          <span>
                            {occ.event.title}
                            <EventStatusSuffix status={occ.event.status} />
                          </span>
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
  onDirtyChange,
  saveRef,
  onSaved,
}: {
  doc: import('yjs').Doc;
  setlists: Record<string, Setlist>;
  onDirtyChange: (dirty: boolean) => void;
  saveRef: RefObject<(() => boolean) | null>;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
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

  const isDirty = Boolean(
    title.trim() || startsAt || endsAt || allDay || location.trim() || notes.trim() || setlistId || repeat !== 'none' || repeatUntil,
  );
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Deliberately reassigned on every render, not behind a dependency array
  // — the unsaved-changes dialog's Save button needs whichever closure over
  // the current field values is freshest at the moment it's clicked.
  useEffect(() => {
    saveRef.current = trySave;
  });

  function trySave(): boolean {
    if (!title.trim() || !startsAt) return false;
    const startMs = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return false;
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
      // Every RepeatOption other than 'none' is already a real SeriesRule['freq'] value.
      createRecurringEvent(doc, input, { freq: repeat, until: repeatUntil || undefined });
    }
    reset();
    return true;
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (trySave()) onSaved();
  }

  return (
    <form onSubmit={handleCreate} className="space-y-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('calendarList.titlePlaceholder')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.type')}
          <Select value={type} onValueChange={(value) => setType(value as EventType)}>
            <SelectTrigger className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gig">{t('calendarList.typeGig')}</SelectItem>
              <SelectItem value="rehearsal">{t('calendarList.typeRehearsal')}</SelectItem>
              <SelectItem value="other">{t('calendarList.typeOther')}</SelectItem>
            </SelectContent>
          </Select>
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
        <Select value={setlistId || NO_SETLIST} onValueChange={(value) => setSetlistId(value === NO_SETLIST ? '' : value)}>
          <SelectTrigger className="max-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SETLIST}>{t('calendarList.noSetlist')}</SelectItem>
            {Object.entries(setlists).map(([id, setlist]) => (
              <SelectItem key={id} value={id}>
                {setlist.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.repeats')}
          <Select value={repeat} onValueChange={(value) => setRepeat(value as RepeatOption)}>
            <SelectTrigger className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('calendarList.repeatNone')}</SelectItem>
              <SelectItem value="weekly">{t('calendarList.repeatWeekly')}</SelectItem>
              <SelectItem value="biweekly">{t('calendarList.repeatBiweekly')}</SelectItem>
              <SelectItem value="every4weeks">{t('calendarList.repeatEvery4Weeks')}</SelectItem>
              <SelectItem value="monthlyByWeekday">{t('calendarList.repeatMonthlyByWeekday')}</SelectItem>
            </SelectContent>
          </Select>
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
      {repeat === 'monthlyByWeekday' &&
        (() => {
          const pattern = describeMonthlyByWeekdayPattern(startsAt, allDay, i18n.language, t);
          return pattern ? (
            <p className="text-xs text-muted-foreground">{t('calendarList.repeatMonthlyByWeekdayHint', { pattern })}</p>
          ) : null;
        })()}

      <Button type="submit" disabled={!title.trim() || !startsAt}>
        <CalendarIcon className="h-4 w-4" aria-hidden="true" />
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

function CreatePollForm({
  doc,
  onDirtyChange,
  saveRef,
  onSaved,
}: {
  doc: import('yjs').Doc;
  onDirtyChange: (dirty: boolean) => void;
  saveRef: RefObject<(() => boolean) | null>;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [optionStarts, setOptionStarts] = useState<string[]>(['']);

  const isDirty = Boolean(title.trim() || notes.trim() || optionStarts.some((s) => s));
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Deliberately reassigned on every render — same reasoning as
  // CreateEventForm's own saveRef effect above.
  useEffect(() => {
    saveRef.current = trySave;
  });

  function trySave(): boolean {
    const options = optionStarts
      .filter((s) => s)
      .map((s) => ({ startsAt: new Date(s).getTime() }))
      .filter((o) => !Number.isNaN(o.startsAt));
    if (!title.trim() || options.length === 0) return false;
    createPoll(doc, { title: title.trim(), notes: notes.trim() || undefined, options });
    setTitle('');
    setNotes('');
    setOptionStarts(['']);
    return true;
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (trySave()) onSaved();
  }

  return (
    <form onSubmit={handleCreate} className="space-y-3">
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
        <BarChart3 className="h-4 w-4" aria-hidden="true" />
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

  // Both create forms live on this one page (they're never a separate
  // route) — the unsaved-changes guard has to cover the page as a whole,
  // so each form reports its own dirty state up and hands over a way to
  // save itself when the dialog's Save button is clicked.
  const [eventFormDirty, setEventFormDirty] = useState(false);
  const [pollFormDirty, setPollFormDirty] = useState(false);
  const eventFormSaveRef = useRef<(() => boolean) | null>(null);
  const pollFormSaveRef = useRef<(() => boolean) | null>(null);
  const unsavedGuard = useUnsavedChangesGuard(eventFormDirty || pollFormDirty);

  // Each create form now lives behind its own icon button, opened as a
  // modal — a second, independent unsaved-changes prompt for just closing
  // that one dialog (Escape, the overlay, or its own X) while dirty, on
  // top of the page-wide guard above for actually navigating away. Nested
  // rather than replacing: the dialog stays open underneath, matching how
  // a native "leave without saving?" prompt stacks over its own page.
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [eventCloseConfirmOpen, setEventCloseConfirmOpen] = useState(false);
  const [pollCloseConfirmOpen, setPollCloseConfirmOpen] = useState(false);

  function handleSaveFromUnsavedDialog() {
    const eventOk = !eventFormDirty || (eventFormSaveRef.current?.() ?? false);
    const pollOk = !pollFormDirty || (pollFormSaveRef.current?.() ?? false);
    if (eventOk && pollOk) unsavedGuard.leave();
  }

  function handleEventDialogOpenChange(open: boolean) {
    if (open || !eventFormDirty) {
      setEventDialogOpen(open);
      return;
    }
    setEventCloseConfirmOpen(true);
  }

  function handlePollDialogOpenChange(open: boolean) {
    if (open || !pollFormDirty) {
      setPollDialogOpen(open);
      return;
    }
    setPollCloseConfirmOpen(true);
  }

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
    <PageShell title={t('calendarList.title')}>
      <UnsavedChangesDialog
        open={unsavedGuard.pending !== null}
        onSave={handleSaveFromUnsavedDialog}
        onDiscard={unsavedGuard.leave}
        onContinueEditing={unsavedGuard.continueEditing}
      />
      <Link to="/dashboard" className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('calendarList.back')}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setViewMode(viewMode === 'month' ? 'list' : 'month')}
        >
          {viewMode === 'month' ? t('calendarList.listView') : t('calendarList.monthView')}
        </Button>
        {canCreate && doc && (
          <button
            type="button"
            onClick={() => setEventDialogOpen(true)}
            aria-label={t('calendarList.createTitle')}
            title={t('calendarList.createTitle')}
            className="flex h-11 w-11 items-center justify-center rounded-md text-primary hover:bg-accent"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
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

      {canCreate && doc && (
        <>
          <Dialog open={eventDialogOpen} onOpenChange={handleEventDialogOpenChange}>
            <DialogContent closeLabel={t('common.close')}>
              <DialogHeader>
                <DialogTitle>{t('calendarList.createTitle')}</DialogTitle>
              </DialogHeader>
              <CreateEventForm
                doc={doc}
                setlists={setlists}
                onDirtyChange={setEventFormDirty}
                saveRef={eventFormSaveRef}
                onSaved={() => setEventDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
          <UnsavedChangesDialog
            open={eventCloseConfirmOpen}
            onSave={() => {
              if (eventFormSaveRef.current?.()) {
                setEventCloseConfirmOpen(false);
                setEventDialogOpen(false);
              }
            }}
            onDiscard={() => {
              setEventFormDirty(false);
              setEventCloseConfirmOpen(false);
              setEventDialogOpen(false);
            }}
            onContinueEditing={() => setEventCloseConfirmOpen(false)}
          />
        </>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium">{t('calendarList.pollsTitle')}</h2>
          {canCreatePoll && doc && (
            <button
              type="button"
              onClick={() => setPollDialogOpen(true)}
              aria-label={t('calendarList.createPollTitle')}
              title={t('calendarList.createPollTitle')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-primary hover:bg-accent"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        {pollEntries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('calendarList.noPolls')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pollEntries.map(([pollId, poll]) => (
              <PollRow key={pollId} bandId={bandId} pollId={pollId} poll={poll} />
            ))}
          </ul>
        )}
        {canCreatePoll && doc && (
          <>
            <Dialog open={pollDialogOpen} onOpenChange={handlePollDialogOpenChange}>
              <DialogContent closeLabel={t('common.close')}>
                <DialogHeader>
                  <DialogTitle>{t('calendarList.createPollTitle')}</DialogTitle>
                </DialogHeader>
                <CreatePollForm
                  doc={doc}
                  onDirtyChange={setPollFormDirty}
                  saveRef={pollFormSaveRef}
                  onSaved={() => setPollDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
            <UnsavedChangesDialog
              open={pollCloseConfirmOpen}
              onSave={() => {
                if (pollFormSaveRef.current?.()) {
                  setPollCloseConfirmOpen(false);
                  setPollDialogOpen(false);
                }
              }}
              onDiscard={() => {
                setPollFormDirty(false);
                setPollCloseConfirmOpen(false);
                setPollDialogOpen(false);
              }}
              onContinueEditing={() => setPollCloseConfirmOpen(false)}
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
