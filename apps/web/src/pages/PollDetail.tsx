// SPDX-License-Identifier: Apache-2.0
import {
  addPollOption,
  type AvailabilityAnswer,
  type BandRole,
  can,
  type Poll,
  rankPollOptions,
  updatePoll,
  votePoll,
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
  useConfirmDialog,
} from '@bandstand/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
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

function formatOptionWhen(startsAt: number, endsAt: number | undefined, locale: string): string {
  const start = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(startsAt));
  if (!endsAt) return start;
  return `${start} – ${new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(endsAt))}`;
}

// How many of the ranked options are worth calling out with a badge: with
// only one or two proposals, ranking beyond 1st tells you nothing you can't
// already see (2nd place in a two-way poll is just "the other one") — 2nd
// place becomes worth surfacing once there's a 3rd option it beats, and 3rd
// place once there's a 4th.
function ranksToShow(optionCount: number): number {
  if (optionCount > 3) return 3;
  if (optionCount > 2) return 2;
  return 1;
}

/**
 * Editing here never touches existing options or their votes — only the
 * poll's own title/notes, plus appending brand-new proposals (which
 * naturally start with no votes at all, same as any other freshly-created
 * option).
 */
function EditPollForm({ doc, poll, pollId, onSaved }: { doc: import('yjs').Doc; poll: Poll; pollId: string; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(poll.title);
  const [notes, setNotes] = useState(poll.notes ?? '');
  const [newOptionStarts, setNewOptionStarts] = useState<string[]>(['']);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const trimmedNotes = notes.trim() || undefined;
    if (title.trim() !== poll.title || trimmedNotes !== poll.notes) {
      updatePoll(doc, pollId, { title: title.trim(), notes: trimmedNotes });
    }
    for (const value of newOptionStarts) {
      if (!value) continue;
      const startsAt = new Date(value).getTime();
      if (!Number.isNaN(startsAt)) addPollOption(doc, pollId, { startsAt });
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('calendarList.pollTitlePlaceholder')} />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('calendarList.pollNotesPlaceholder')} />

      <div>
        <p className="text-sm font-medium text-muted-foreground">{t('pollDetail.existingOptions')}</p>
        <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
          {poll.options.map((option) => (
            <li key={option.id}>{formatOptionWhen(option.startsAt, option.endsAt, i18n.language)}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{t('pollDetail.addProposals')}</p>
        {newOptionStarts.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={value}
              onChange={(e) => setNewOptionStarts((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            />
            {newOptionStarts.length > 1 && (
              <button
                type="button"
                onClick={() => setNewOptionStarts((prev) => prev.filter((_, i) => i !== index))}
                className="text-sm text-muted-foreground hover:underline"
              >
                {t('calendarList.removeOption')}
              </button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setNewOptionStarts((prev) => [...prev, ''])}>
          {t('calendarList.addOption')}
        </Button>
      </div>

      <Button type="submit" disabled={!title.trim()}>
        {t('pollDetail.saveChanges')}
      </Button>
    </form>
  );
}

function CloseSection({ bandId, pollId, poll }: { bandId: string; pollId: string; poll: Poll }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [optionId, setOptionId] = useState(poll.options[0]?.id ?? '');
  const [title, setTitle] = useState(poll.title);
  const [type, setType] = useState<'gig' | 'rehearsal' | 'other'>('rehearsal');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);

  async function handleClose() {
    if (!optionId || !title.trim()) return;
    setClosing(true);
    try {
      const result = await apiClient.closePoll(bandId, pollId, {
        optionId,
        title: title.trim(),
        type,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      navigate(`/bands/${bandId}/calendar/${result.eventId}`);
    } catch {
      setClosing(false);
    }
  }

  if (!expanded) {
    return (
      <Button type="button" variant="outline" onClick={() => setExpanded(true)} className="mt-4">
        {t('pollDetail.closeSectionTitle')}
      </Button>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border p-4">
      <h2 className="font-medium">{t('pollDetail.closeSectionTitle')}</h2>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('pollDetail.closeOptionLabel')}
        <Select value={optionId} onValueChange={setOptionId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {poll.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {formatOptionWhen(option.startsAt, option.endsAt, i18n.language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('pollDetail.eventTitleLabel')} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('pollDetail.eventTypeLabel')}
        <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gig">{t('calendarList.typeGig')}</SelectItem>
            <SelectItem value="rehearsal">{t('calendarList.typeRehearsal')}</SelectItem>
            <SelectItem value="other">{t('calendarList.typeOther')}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('pollDetail.location')} />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('pollDetail.notesLabel')} />
      <Button type="button" disabled={closing || !optionId || !title.trim()} onClick={() => void handleClose()}>
        {closing ? t('pollDetail.closing') : t('pollDetail.confirmClose')}
      </Button>
    </div>
  );
}

export function PollDetail() {
  const { t, i18n } = useTranslation();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();
  const { bandId, pollId } = useParams<{ bandId: string; pollId: string }>();
  const { data: session } = authClient.useSession();
  const { doc, status } = useBandDoc(bandId ?? null);
  const polls = useYMap<Poll>(doc?.getMap('polls'));
  const pollVotes = useYMap<AvailabilityAnswer>(doc?.getMap('pollVotes'));
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyBands().then((bands) => setViewerRole(bands.find((b) => b.id === bandId)?.role ?? null));
  }, [bandId]);

  if (!bandId || !pollId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;

  const poll = polls[pollId];
  if (!poll) {
    return (
      <PageShell title={t('pollDetail.notFound')}>
        <Link to={`/bands/${bandId}/calendar`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
          &larr; {t('pollDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t('pollDetail.notFound')}</p>
      </PageShell>
    );
  }

  const currentUserId = session?.user.id;
  const votesForPoll: Record<string, AvailabilityAnswer> = {};
  const prefix = `${pollId}:`;
  for (const [key, answer] of Object.entries(pollVotes)) {
    if (key.startsWith(prefix)) votesForPoll[key.slice(prefix.length)] = answer;
  }
  const ranked = rankPollOptions(votesForPoll, poll.options);
  const visibleRanks = ranksToShow(poll.options.length);

  const canClose = viewerRole ? can(viewerRole, 'poll:close') : false;
  const canEditPoll = viewerRole ? can(viewerRole, 'poll:edit') : false;

  function handleVote(optionId: string, answer: AvailabilityAnswer) {
    if (!doc || !currentUserId || !pollId) return;
    votePoll(doc, pollId, optionId, currentUserId, answer);
  }

  async function handleDelete() {
    if (!bandId || !pollId || !poll) return;
    const confirmed = await confirm({
      title: t('pollDetail.confirmDelete', { name: poll.title }),
      confirmLabel: t('pollDetail.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await apiClient.deletePoll(bandId, pollId);
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <PageShell title={poll.title}>
      <Link to={`/bands/${bandId}/calendar`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('pollDetail.back')}
      </Link>

      {poll.notes && (
        <div className="mt-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('pollDetail.notes')}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{poll.notes}</p>
        </div>
      )}

      {poll.resolvedEventId ? (
        <div className="relative mt-4 rounded-md border border-border p-3 hover:bg-accent/50">
          <Link
            to={`/bands/${bandId}/calendar/${poll.resolvedEventId}`}
            className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label={t('pollDetail.viewEvent')}
          />
          {/* Plain text, not independently interactive — no `relative`, so
              the absolutely-positioned link above stays on top and
              clickable through it (a `relative` sibling defined later in
              the DOM would otherwise paint over an earlier absolutely
              -positioned one, per CSS's stacking-order rules). */}
          <p>{t('pollDetail.resolvedTo')}</p>
          <p className="text-sm text-primary">{t('pollDetail.viewEvent')}</p>
        </div>
      ) : (
        <>
          {/* Deliberately kept in the poll's own option order, not re-sorted
              by rank — this list re-renders live as other members vote, and
              reordering rows under a voter's finger mid-click would be a
              real hazard in a collaborative poll. The rank badge alone
              carries the ranking; only the list order stays put. */}
          <ul className="mt-6 space-y-3">
            {poll.options.map((option) => {
              const tally = ranked.find((r) => r.optionId === option.id);
              if (!tally) return null;
              const myAnswer = currentUserId ? votesForPoll[`${option.id}:${currentUserId}`] : undefined;
              const showRank = tally.rank <= visibleRanks && tally.yes > 0;
              return (
                <li key={option.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="wrap-break-word font-medium">
                      {formatOptionWhen(option.startsAt, option.endsAt, i18n.language)}
                      {showRank && (
                        <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {t('pollDetail.rank', { rank: tally.rank })}
                        </span>
                      )}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {t('pollDetail.votesCount', { yes: tally.yes, maybe: tally.maybe, no: tally.no })}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ANSWERS.map((answer) => (
                      <Button
                        key={answer}
                        type="button"
                        size="sm"
                        variant={myAnswer === answer ? 'default' : 'outline'}
                        onClick={() => handleVote(option.id, answer)}
                        className="h-11 min-w-11"
                      >
                        {t(ANSWER_LABEL_KEY[answer])}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          {canClose && <CloseSection bandId={bandId} pollId={pollId} poll={poll} />}
        </>
      )}

      {(canClose || (canEditPoll && !poll.resolvedEventId)) && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {canEditPoll && !poll.resolvedEventId && (
            <button
              type="button"
              onClick={() => setEditDialogOpen(true)}
              aria-label={t('pollDetail.edit')}
              title={t('pollDetail.edit')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <Pencil className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canClose && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDelete()}
              aria-label={deleting ? t('pollDetail.deleting') : t('pollDetail.delete')}
              title={deleting ? t('pollDetail.deleting') : t('pollDetail.delete')}
              className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {canEditPoll && !poll.resolvedEventId && doc && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('pollDetail.editTitle')}</DialogTitle>
            </DialogHeader>
            <EditPollForm doc={doc} poll={poll} pollId={pollId} onSaved={() => setEditDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
