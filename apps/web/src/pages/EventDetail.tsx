// SPDX-License-Identifier: Apache-2.0
import {
  type AvailabilityAnswer,
  type BandMember,
  type BandRole,
  buildLocationHref,
  can,
  cancelOccurrence,
  type CalendarEvent,
  changeSeriesRecurrence,
  createSeriesException,
  type EventStatus,
  type EventType,
  findOccurrenceEvent,
  respondAvailability,
  type SeriesRule,
  type Setlist,
  updateOccurrence,
} from '@bandstand/core';
import {
  Button,
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
  useConfirmDialog,
} from '@bandstand/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { EventStatusSuffix } from '../components/EventStatusSuffix';
import { useBandDoc } from '../hooks/useBandDoc';
import { useNicknames } from '../hooks/useNicknames';
import { useTrustedSession } from '../hooks/useTrustedSession';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';

// The single trash button permanently deletes only within this window after
// the event was created (never after an edit — createdAt is set once and
// never touched again, see the schema's own comment); past it, or for an
// event that was never actually created for real yet (a virtual, unmaterialized
// occurrence), the same button cancels instead.
const DELETE_GRACE_PERIOD_MS = 5 * 60 * 1000;

// Radix Select reserves the empty string for "no selection" internally —
// the old native <option value=""> for "no linked setlist" needs its own
// sentinel instead.
const NO_SETLIST = '__none__';

// Same set Calendar.tsx's own create-form offers (its own local
// RepeatOption) — legacy 'monthly' is deliberately never offered going
// forward, only ever read back from a series created before
// 'monthlyByWeekday' existed. Kept separate from that type rather than
// exported/shared: both are a trivial, page-local mapping onto
// SeriesRule['freq'], not a concept core needs to know about.
type RepeatOption = 'weekly' | 'biweekly' | 'every4weeks' | 'monthlyByWeekday';

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
 *
 * `isSeriesTemplateOccurrence` mirrors EventDetail's own flag (see its
 * comment): saving an edit to the template's own occurrence would
 * otherwise silently patch the template itself, cascading onto every
 * future occurrence that doesn't already have its own exception — same
 * class of bug as the cancel button's, just for every other field
 * (including notes — there's nothing special-casing them, they're patched
 * through the same object as everything else). Unlike cancel, an edit
 * genuinely has two legitimate scopes, so this asks instead of always
 * picking one: "just this date" (a fresh exception) or "this and all
 * following" (the existing template-patch behavior, which already leaves
 * any *other* occurrence's own existing exception alone — untouched
 * either way, per the user's own call on this).
 */
interface EditEventValues {
  title: string;
  type: EventType;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  location: string;
  notes: string;
  setlistId: string;
  status: EventStatus;
}

function EditEventForm({
  doc,
  event,
  occurrenceId,
  isSeriesTemplateOccurrence,
  setlists,
  onSaved,
}: {
  doc: import('yjs').Doc;
  event: CalendarEvent;
  occurrenceId: string;
  isSeriesTemplateOccurrence: boolean;
  setlists: Record<string, Setlist>;
  onSaved: (savedOccurrenceId: string) => void;
}) {
  const { t } = useTranslation();
  const { chooseAction } = useConfirmDialog();
  const form = useForm<EditEventValues>({
    defaultValues: {
      title: event.title,
      type: event.type,
      allDay: event.allDay,
      startsAt: event.allDay ? toDateValue(event.startsAt) : toDateTimeLocalValue(event.startsAt),
      endsAt: event.endsAt === undefined ? '' : event.allDay ? toDateValue(event.endsAt) : toDateTimeLocalValue(event.endsAt),
      location: event.location ?? '',
      notes: event.notes ?? '',
      setlistId: event.setlistId ?? '',
      status: event.status,
    },
  });
  const values = useWatch({ control: form.control });

  async function onSubmit(formValues: EditEventValues) {
    const { title, type, allDay, startsAt, endsAt, location, notes, setlistId, status } = formValues;
    if (!title.trim() || !startsAt) return;
    const startMs = allDay ? Date.parse(`${startsAt}T00:00:00.000Z`) : new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return;
    const endMs = endsAt
      ? allDay
        ? Date.parse(`${endsAt}T23:59:59.999Z`)
        : new Date(endsAt).getTime()
      : undefined;

    const patch = {
      type,
      title: title.trim(),
      startsAt: startMs,
      endsAt: endMs !== undefined && !Number.isNaN(endMs) ? endMs : undefined,
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      setlistId: setlistId || undefined,
      status,
    };

    if (isSeriesTemplateOccurrence && event.seriesId) {
      const scope = await chooseAction<'occurrence' | 'series'>({
        title: t('eventDetail.editScopeTitle'),
        description: t('eventDetail.editScopeDescription'),
        cancelLabel: t('common.cancel'),
        actions: [
          { label: t('eventDetail.editScopeThisOccurrence'), value: 'occurrence' },
          { label: t('eventDetail.editScopeThisAndFollowing'), value: 'series' },
        ],
      });
      if (scope === null) return;
      if (scope === 'occurrence') {
        onSaved(createSeriesException(doc, event.seriesId, toDateValue(event.startsAt), patch));
        return;
      }
      // scope === 'series' falls through to the same template-patch call
      // below as a non-series (or already-materialized) edit — the
      // template's own occurrence IS occurrenceId here.
    }

    onSaved(updateOccurrence(doc, occurrenceId, patch));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('eventDetail.status')}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem className="contents">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EVENT_STATUS_LABEL_KEY) as EventStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(EVENT_STATUS_LABEL_KEY[s])}
                        </SelectItem>
                      ))}
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
                      onBlur={field.onBlur}
                      ref={field.ref}
                      onChange={(e) => {
                        const nextAllDay = e.target.checked;
                        const prevAllDay = field.value;
                        field.onChange(nextAllDay);
                        // Switching representations mid-edit would otherwise
                        // carry a stale local-time or UTC-midnight value
                        // across into the other input type — re-derive both
                        // from the same instant.
                        const { startsAt: curStartsAt, endsAt: curEndsAt } = form.getValues();
                        const startMs = prevAllDay
                          ? Date.parse(`${curStartsAt}T00:00:00.000Z`)
                          : new Date(curStartsAt).getTime();
                        if (!Number.isNaN(startMs)) {
                          form.setValue('startsAt', nextAllDay ? toDateValue(startMs) : toDateTimeLocalValue(startMs));
                        }
                        if (curEndsAt) {
                          const endMs = prevAllDay
                            ? Date.parse(`${curEndsAt}T23:59:59.999Z`)
                            : new Date(curEndsAt).getTime();
                          if (!Number.isNaN(endMs)) {
                            form.setValue('endsAt', nextAllDay ? toDateValue(endMs) : toDateTimeLocalValue(endMs));
                          }
                        }
                      }}
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

        <Button type="submit" disabled={!values.title?.trim() || !values.startsAt}>
          {t('eventDetail.saveChanges')}
        </Button>
      </form>
    </Form>
  );
}

/**
 * A dedicated flow, deliberately separate from EditEventForm above (see its
 * own doc comment) — changing a series' pattern restructures the whole
 * series (see `changeSeriesRecurrence`'s own comment on why it splits the
 * series into two templates rather than patching the rule in place), which
 * is a bigger decision than a normal field edit and doesn't fit that form's
 * per-field patch model. Always scoped to "this date and every following
 * occurrence" — there's no "just this date" equivalent for a recurrence
 * rule, so unlike EditEventForm this never asks.
 */
function ChangeRecurrenceForm({
  doc,
  seriesTemplateId,
  currentRule,
  effectiveFromDate,
  onSaved,
}: {
  doc: import('yjs').Doc;
  seriesTemplateId: string;
  currentRule: SeriesRule | undefined;
  effectiveFromDate: string;
  onSaved: (newTemplateId: string) => void;
}) {
  const { t } = useTranslation();
  const form = useForm<{ repeat: RepeatOption; until: string }>({
    defaultValues: {
      repeat: currentRule && currentRule.freq !== 'monthly' ? currentRule.freq : 'weekly',
      until: currentRule?.until ?? '',
    },
  });

  function onSubmit(values: { repeat: RepeatOption; until: string }) {
    onSaved(
      changeSeriesRecurrence(doc, seriesTemplateId, effectiveFromDate, {
        freq: values.repeat,
        until: values.until || undefined,
      }),
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('eventDetail.changeRecurrenceDescription', { date: effectiveFromDate })}
        </p>
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
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('calendarList.repeatUntil')}
            <FormField
              control={form.control}
              name="until"
              render={({ field }) => (
                <FormItem className="contents">
                  <FormControl>
                    <Input type="date" className="w-auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </label>
        </div>
        <Button type="submit">{t('eventDetail.saveChanges')}</Button>
      </form>
    </Form>
  );
}

function AvailabilityRow({
  displayName,
  answer,
  isSelf,
  onRespond,
}: {
  displayName: string;
  answer: AvailabilityAnswer | undefined;
  isSelf: boolean;
  onRespond?: (answer: AvailabilityAnswer) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="wrap-break-word">{displayName}</span>
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
  const { confirm, chooseAction } = useConfirmDialog();
  const navigate = useNavigate();
  const { bandId, occurrenceId } = useParams<{ bandId: string; occurrenceId: string }>();
  const { data: session } = useTrustedSession();
  const { doc, status } = useBandDoc(bandId ?? null);
  const events = useYMap<CalendarEvent>(doc?.getMap('events'));
  const availability = useYMap<AvailabilityAnswer>(doc?.getMap('availability'));
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const nicknames = useNicknames(bandId);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Captured once at mount, not read fresh on every render — Date.now() is
  // an impure call React's render purity rules disallow directly in the
  // component body (same reasoning as Calendar.tsx's own `now` state); the
  // five-minute grace period below doesn't need tighter precision than that.
  const [now] = useState(() => Date.now());
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [changeRecurrenceDialogOpen, setChangeRecurrenceDialogOpen] = useState(false);

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
  // The series' own template record IS that real entry when its own first
  // occurrence is open (occurrenceId === event.seriesId) — never eligible
  // for a same-occurrence permanent delete, unlike a genuine materialized
  // exception: deleting the template row would delete the recurrence rule
  // itself, taking the whole series with it. See performCancel's own
  // comment for the matching fix on the cancel side of this.
  const isSeriesTemplateOccurrence = event.seriesId !== undefined && occurrenceId === event.seriesId;
  // The template's own current rule, for prefilling ChangeRecurrenceForm —
  // read from the raw template entry, not `event`: a materialized
  // exception's own `event.seriesRule` is always undefined (createSeriesException
  // strips it), even though `event.seriesId` still names its template.
  const seriesTemplate = event.seriesId ? events[event.seriesId] : undefined;
  // Once an occurrence is already cancelled, offering to "cancel" it again
  // makes no sense — the only thing left to do is remove the cancellation
  // record outright (a plain event goes away entirely; a cancelled series
  // exception reverts that date to a normal, active occurrence again, same
  // as if it had never been cancelled). Always a real, hard delete: a
  // cancelled occurrence is never virtual (only a real exception carries a
  // status at all) and never the template (which can no longer end up
  // `cancelled` itself after the fix above).
  const isAlreadyCancelled = event.status === 'cancelled';
  const canPermanentlyDelete =
    isAlreadyCancelled ||
    (!isVirtualOccurrence &&
      !isSeriesTemplateOccurrence &&
      event.createdAt !== undefined &&
      now - event.createdAt < DELETE_GRACE_PERIOD_MS);
  const linkedSetlist = event.setlistId ? doc?.getMap('setlists').get(event.setlistId) as { name: string } | undefined : undefined;
  const locationHref = event.location ? buildLocationHref(event.location, event.locationGeo) : undefined;

  function handleRespond(answer: AvailabilityAnswer) {
    if (!doc || !currentUserId || !occurrenceId) return;
    respondAvailability(doc, occurrenceId, currentUserId, answer);
  }

  async function performDelete() {
    if (!bandId || !occurrenceId) return;
    setDeleting(true);
    try {
      await apiClient.deleteEvent(bandId, occurrenceId);
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  function performCancel() {
    if (!doc || !occurrenceId || !bandId || !event) return;
    // Cancelling the series template's own occurrence must never patch the
    // template record itself — updateOccurrence patches any real entry in
    // place, and the template IS a real entry, but a `status: 'cancelled'`
    // there is a property of the *template*, which resolveEventOccurrences
    // then spreads onto every future virtual occurrence it generates —
    // cancelling one date this way silently cancelled the entire series.
    // cancelOccurrence always creates a proper per-date exception instead,
    // exactly like a virtual occurrence's own cancellation does, leaving
    // the template (and every other date) untouched.
    const savedOccurrenceId =
      isSeriesTemplateOccurrence && event.seriesId
        ? cancelOccurrence(doc, event.seriesId, toDateValue(event.startsAt))
        : updateOccurrence(doc, occurrenceId, { status: 'cancelled' });
    if (savedOccurrenceId !== occurrenceId) {
      navigate(`/bands/${bandId}/calendar/${savedOccurrenceId}`, { replace: true });
    }
  }

  async function performDeleteOrCancelOccurrence() {
    if (canPermanentlyDelete) {
      await performDelete();
    } else {
      performCancel();
    }
  }

  async function performDeleteSeries() {
    if (!bandId || !event?.seriesId) return;
    setDeleting(true);
    try {
      await apiClient.deleteEvent(bandId, event.seriesId, 'series');
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  // One trash button, one dialog — a plain event asks a single yes/no
  // (delete for good, or cancel, depending on canPermanentlyDelete); an
  // occurrence of a recurring series instead asks which scope to act on,
  // since "delete this button" is genuinely ambiguous there (see the
  // previous two-icon layout this replaced).
  async function handleTrashClick() {
    if (!event) return;

    if (event.seriesId) {
      const choice = await chooseAction<'occurrence' | 'series'>({
        title: t('eventDetail.deleteChoiceTitle', { name: event.title }),
        description: t('eventDetail.deleteChoiceDescription'),
        cancelLabel: t('common.cancel'),
        actions: [
          {
            label: canPermanentlyDelete ? t('eventDetail.delete') : t('eventDetail.cancelEventAction'),
            value: 'occurrence',
          },
          { label: t('eventDetail.deleteSeries'), value: 'series' },
        ],
      });
      if (choice === 'occurrence') await performDeleteOrCancelOccurrence();
      else if (choice === 'series') await performDeleteSeries();
      return;
    }

    // Not eventDetail.cancel for the confirmLabel below — that's the trash
    // icon's own short tooltip text, and in English it's the same word as
    // this dialog's own generic dismiss button (common.cancel), which would
    // otherwise put two buttons both labeled "Cancel" in the same dialog.
    const confirmed = await confirm({
      title: canPermanentlyDelete
        ? t('eventDetail.confirmDelete', { name: event.title })
        : t('eventDetail.confirmCancel', { name: event.title }),
      confirmLabel: canPermanentlyDelete ? t('eventDetail.delete') : t('eventDetail.cancelEventAction'),
      cancelLabel: t('common.cancel'),
    });
    if (confirmed) await performDeleteOrCancelOccurrence();
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
              displayName={nicknames.displayName(member)}
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
              <Pencil className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            // One button. For a plain event: within DELETE_GRACE_PERIOD_MS
            // of creation (never of a later edit) a confirm dialog deletes
            // for good, same as a fresh mistake being undone; after that —
            // or for a virtual occurrence, which has no real entry yet to
            // delete — it cancels instead. For an occurrence that belongs to
            // a recurring series, the dialog instead asks whether to act on
            // just this date or the entire series (see handleTrashClick) —
            // previously a second, identically-styled trash icon sat next
            // to this one for that case, indistinguishable at a glance.
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleTrashClick()}
              aria-label={
                canPermanentlyDelete ? (deleting ? t('eventDetail.deleting') : t('eventDetail.delete')) : t('eventDetail.cancel')
              }
              title={
                canPermanentlyDelete ? (deleting ? t('eventDetail.deleting') : t('eventDetail.delete')) : t('eventDetail.cancel')
              }
              className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canEdit && event.seriesId && (
            <Button variant="outline" size="sm" onClick={() => setChangeRecurrenceDialogOpen(true)}>
              {t('eventDetail.changeRecurrence')}
            </Button>
          )}
        </div>
      )}

      {canEdit && doc && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('eventDetail.editTitle')}</DialogTitle>
            </DialogHeader>
            <EditEventForm
              doc={doc}
              event={event}
              occurrenceId={occurrenceId}
              isSeriesTemplateOccurrence={isSeriesTemplateOccurrence}
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
          </DialogContent>
        </Dialog>
      )}

      {canEdit && doc && event.seriesId && (
        <Dialog open={changeRecurrenceDialogOpen} onOpenChange={setChangeRecurrenceDialogOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('eventDetail.changeRecurrenceTitle')}</DialogTitle>
            </DialogHeader>
            <ChangeRecurrenceForm
              doc={doc}
              seriesTemplateId={event.seriesId}
              currentRule={seriesTemplate?.seriesRule}
              effectiveFromDate={toDateValue(event.startsAt)}
              onSaved={(newTemplateId) => {
                setChangeRecurrenceDialogOpen(false);
                if (bandId) navigate(`/bands/${bandId}/calendar/${newTemplateId}`, { replace: true });
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
