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
  Calendar as CalendarGrid,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
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
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
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

  // react-day-picker's `month`/day generation runs in local time, while
  // monthCursor (and every occurrence's `date` bucket key, see isoDate/
  // toIsoDate) is UTC-anchored — re-deriving a local midnight for the same
  // calendar year/month avoids a UTC-midnight instant reading as the
  // previous local day for viewers west of UTC.
  const localMonth = new Date(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), 1);
  const localMonthEnd = new Date(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 0);

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
        <CalendarGrid
          month={localMonth}
          hideNavigation
          showOutsideDays
          formatters={{
            formatWeekdayName: (date) =>
              new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(date),
          }}
          components={{
            Day: ({ day }) => {
              // Outside the displayed month: a leading day (before day 1)
              // renders as an empty bordered placeholder, matching the old
              // grid's blank leading cells; a trailing day (after the last
              // day) renders as nothing at all, matching the old grid's lack
              // of any end-of-month padding.
              if (day.date < localMonth) {
                return <td className="min-h-24 rounded-md border border-border p-1" />;
              }
              if (day.date > localMonthEnd) {
                return <td />;
              }
              const dateKey = isoDate(
                new Date(Date.UTC(day.date.getFullYear(), day.date.getMonth(), day.date.getDate())),
              );
              const dayOccurrences = byDate.get(dateKey) ?? [];
              return (
                <td className="min-h-24 rounded-md border border-border p-1 align-top">
                  <p className="text-xs text-muted-foreground">{day.date.getDate()}</p>
                  <ul className="mt-1 space-y-0.5">
                    {dayOccurrences.map((occ) => (
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
                </td>
              );
            },
          }}
        />
      )}
    </div>
  );
}

interface CreateEventValues {
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  setlistId: string;
  repeat: RepeatOption;
  repeatUntil: string;
}

const createEventDefaults: CreateEventValues = {
  title: '',
  type: 'rehearsal',
  startsAt: '',
  endsAt: '',
  allDay: false,
  location: '',
  notes: '',
  setlistId: '',
  repeat: 'none',
  repeatUntil: '',
};

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
  const form = useForm<CreateEventValues>({ defaultValues: createEventDefaults });
  const values = useWatch({ control: form.control });

  useEffect(() => {
    onDirtyChange(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);

  // Deliberately reassigned on every render, not behind a dependency array
  // — the unsaved-changes dialog's Save button needs whichever closure over
  // the current field values is freshest at the moment it's clicked.
  useEffect(() => {
    saveRef.current = trySave;
  });

  // Reads live form state itself (via form.getValues()) rather than going
  // through RHF's own handleSubmit/resolver pipeline — the unsaved-changes
  // dialog needs to call this synchronously and get an immediate boolean
  // back, which an inherently-async validation pipeline can't provide. The
  // validation here (title + a parseable start) is exactly what the
  // disabled submit button below already enforces, so nothing is skipped.
  function trySave(): boolean {
    const { title, type, startsAt, endsAt, allDay, location, notes, setlistId, repeat, repeatUntil } =
      form.getValues();
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
    form.reset();
    return true;
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (trySave()) onSaved();
  }

  return (
    <Form {...form}>
      <form onSubmit={handleCreate} className="space-y-3">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input placeholder={t('calendarList.titlePlaceholder')} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.type')}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem className="contents">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gig">{t('calendarList.typeGig')}</SelectItem>
                      <SelectItem value="rehearsal">{t('calendarList.typeRehearsal')}</SelectItem>
                      <SelectItem value="other">{t('calendarList.typeOther')}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </label>
          <FormField
            control={form.control}
            name="allDay"
            render={({ field }) => (
              <FormItem className="contents">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FormControl>
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  {t('calendarList.allDay')}
                </label>
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.startsAt')}
            <FormField
              control={form.control}
              name="startsAt"
              render={({ field }) => (
                <FormItem className="contents">
                  <FormControl>
                    <Input type={values.allDay ? 'date' : 'datetime-local'} className="w-auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.endsAt')}
            <FormField
              control={form.control}
              name="endsAt"
              render={({ field }) => (
                <FormItem className="contents">
                  <FormControl>
                    <Input type={values.allDay ? 'date' : 'datetime-local'} className="w-auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </label>
        </div>

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input placeholder={t('calendarList.location')} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Textarea placeholder={t('calendarList.notes')} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('calendarList.linkedSetlist')}
          <FormField
            control={form.control}
            name="setlistId"
            render={({ field }) => (
              <FormItem className="contents">
                <Select
                  value={field.value || NO_SETLIST}
                  onValueChange={(value) => field.onChange(value === NO_SETLIST ? '' : value)}
                >
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
              </FormItem>
            )}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.repeats')}
            <FormField
              control={form.control}
              name="repeat"
              render={({ field }) => (
                <FormItem className="contents">
                  <Select value={field.value} onValueChange={field.onChange}>
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
                </FormItem>
              )}
            />
          </label>
          {values.repeat !== 'none' && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t('calendarList.repeatUntil')}
              <FormField
                control={form.control}
                name="repeatUntil"
                render={({ field }) => (
                  <FormItem className="contents">
                    <FormControl>
                      <Input type="date" className="w-auto" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </label>
          )}
        </div>
        {values.repeat === 'monthlyByWeekday' &&
          (() => {
            const pattern = describeMonthlyByWeekdayPattern(
              values.startsAt ?? '',
              values.allDay ?? false,
              i18n.language,
              t,
            );
            return pattern ? (
              <p className="text-xs text-muted-foreground">{t('calendarList.repeatMonthlyByWeekdayHint', { pattern })}</p>
            ) : null;
          })()}

        <Button type="submit" disabled={!values.title?.trim() || !values.startsAt}>
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          {t('calendarList.create')}
        </Button>
      </form>
    </Form>
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

interface CreatePollValues {
  title: string;
  notes: string;
  optionStarts: { value: string }[];
}

const createPollDefaults: CreatePollValues = { title: '', notes: '', optionStarts: [{ value: '' }] };

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
  const form = useForm<CreatePollValues>({ defaultValues: createPollDefaults });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'optionStarts' });
  const values = useWatch({ control: form.control });

  useEffect(() => {
    onDirtyChange(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);

  // Deliberately reassigned on every render — same reasoning as
  // CreateEventForm's own saveRef effect above.
  useEffect(() => {
    saveRef.current = trySave;
  });

  // Reads live form state itself rather than going through RHF's own
  // handleSubmit/resolver pipeline — see CreateEventForm's trySave for why.
  function trySave(): boolean {
    const { title, notes, optionStarts } = form.getValues();
    const options = optionStarts
      .map((o) => o.value)
      .filter((s) => s)
      .map((s) => ({ startsAt: new Date(s).getTime() }))
      .filter((o) => !Number.isNaN(o.startsAt));
    if (!title.trim() || options.length === 0) return false;
    createPoll(doc, { title: title.trim(), notes: notes.trim() || undefined, options });
    form.reset();
    return true;
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (trySave()) onSaved();
  }

  return (
    <Form {...form}>
      <form onSubmit={handleCreate} className="space-y-3">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input placeholder={t('calendarList.pollTitlePlaceholder')} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Textarea placeholder={t('calendarList.pollNotesPlaceholder')} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="space-y-2">
          {fields.map((arrayField, index) => (
            <div key={arrayField.id} className="flex items-center gap-2">
              <FormField
                control={form.control}
                name={`optionStarts.${index}.value`}
                render={({ field }) => (
                  <FormItem className="contents">
                    <FormControl>
                      <Input type="datetime-local" className="w-auto" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  {t('calendarList.removeOption')}
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ value: '' })}>
            {t('calendarList.addOption')}
          </Button>
        </div>
        <Button
          type="submit"
          disabled={!values.title?.trim() || (values.optionStarts ?? []).every((o) => !o?.value)}
        >
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          {t('calendarList.createPoll')}
        </Button>
      </form>
    </Form>
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
