// SPDX-License-Identifier: Apache-2.0
import { type AvailabilityAnswer, type BandRole, can, getPollResults, type Poll, votePoll } from '@bandstand/core';
import { Button, Input, Textarea } from '@bandstand/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader';
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
        <select
          value={optionId}
          onChange={(e) => setOptionId(e.target.value)}
          className="h-10 rounded-md border border-border bg-background px-2 text-sm"
        >
          {poll.options.map((option) => (
            <option key={option.id} value={option.id}>
              {formatOptionWhen(option.startsAt, option.endsAt, i18n.language)}
            </option>
          ))}
        </select>
      </label>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('pollDetail.eventTitleLabel')} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t('pollDetail.eventTypeLabel')}
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="h-10 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="gig">{t('calendarList.typeGig')}</option>
          <option value="rehearsal">{t('calendarList.typeRehearsal')}</option>
          <option value="other">{t('calendarList.typeOther')}</option>
        </select>
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
  const navigate = useNavigate();
  const { bandId, pollId } = useParams<{ bandId: string; pollId: string }>();
  const { data: session } = authClient.useSession();
  const { doc, status } = useBandDoc(bandId ?? null);
  const polls = useYMap<Poll>(doc?.getMap('polls'));
  const pollVotes = useYMap<AvailabilityAnswer>(doc?.getMap('pollVotes'));
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyBands().then((bands) => setViewerRole(bands.find((b) => b.id === bandId)?.role ?? null));
  }, [bandId]);

  if (!bandId || !pollId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;

  const poll = polls[pollId];
  if (!poll) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <AppHeader title={t('pollDetail.notFound')} />
        <Link to={`/bands/${bandId}/calendar`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
          &larr; {t('pollDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t('pollDetail.notFound')}</p>
      </main>
    );
  }

  const currentUserId = session?.user.id;
  const votesForPoll: Record<string, AvailabilityAnswer> = {};
  const prefix = `${pollId}:`;
  for (const [key, answer] of Object.entries(pollVotes)) {
    if (key.startsWith(prefix)) votesForPoll[key.slice(prefix.length)] = answer;
  }
  const results = getPollResults(votesForPoll, poll.options);
  const bestOptionId = results.reduce<{ id: string; yes: number } | null>((best, r) => {
    if (r.yes > 0 && (!best || r.yes > best.yes)) return { id: r.optionId, yes: r.yes };
    return best;
  }, null)?.id;

  const canClose = viewerRole ? can(viewerRole, 'poll:close') : false;

  function handleVote(optionId: string, answer: AvailabilityAnswer) {
    if (!doc || !currentUserId || !pollId) return;
    votePoll(doc, pollId, optionId, currentUserId, answer);
  }

  async function handleDelete() {
    if (!bandId || !pollId || !poll) return;
    if (!window.confirm(t('pollDetail.confirmDelete', { name: poll.title }))) return;
    setDeleting(true);
    try {
      await apiClient.deletePoll(bandId, pollId);
      navigate(`/bands/${bandId}/calendar`);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <AppHeader title={poll.title} />
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
          <ul className="mt-6 space-y-3">
            {poll.options.map((option) => {
              const tally = results.find((r) => r.optionId === option.id);
              const myAnswer = currentUserId ? votesForPoll[`${option.id}:${currentUserId}`] : undefined;
              return (
                <li key={option.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="wrap-break-word font-medium">
                      {formatOptionWhen(option.startsAt, option.endsAt, i18n.language)}
                      {option.id === bestOptionId && (
                        <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {t('pollDetail.bestFit')}
                        </span>
                      )}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {tally && t('pollDetail.votesCount', { yes: tally.yes, maybe: tally.maybe, no: tally.no })}
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

      {canClose && (
        <div className="mt-6 border-t border-border pt-4">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="text-sm text-destructive hover:underline disabled:opacity-50"
          >
            {deleting ? t('pollDetail.deleting') : t('pollDetail.delete')}
          </button>
        </div>
      )}
    </main>
  );
}
