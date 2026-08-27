// SPDX-License-Identifier: Apache-2.0
import { castVote, getIdeaVoteTally, setSongStatus } from '@bandstand/core';
import type { Song, Vote } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { apiClient } from '../lib/api-client';

export function IdeaVoting({
  bandId,
  doc,
  songId,
  song,
  currentUserId,
  totalMembers,
  canResolveTie,
}: {
  bandId: string;
  doc: Y.Doc;
  songId: string;
  song: Song;
  currentUserId: string;
  totalMembers: number;
  canResolveTie: boolean;
}) {
  const { t } = useTranslation();
  const [resolving, setResolving] = useState(false);
  const tally = getIdeaVoteTally(song, totalMembers);
  const myVote = song.votes[currentUserId];

  function vote(value: Vote) {
    castVote(doc, songId, currentUserId, value);
  }

  // A non-tied majority is every member's ordinary right, so it stays plain
  // CRDT. A tie specifically requires the resolve-tie REST endpoint (see
  // docs/adr/0005-permissions.md) — an admin/owner's browser is not
  // supposed to flip the song's status directly for this case, even though
  // the underlying setSongStatus call is otherwise open to everyone.
  async function resolve(status: 'active' | 'archived') {
    if (tally.majority !== 'tie') {
      setSongStatus(doc, songId, status);
      return;
    }
    setResolving(true);
    try {
      await apiClient.resolveIdeaTie(bandId, songId, { resolution: status });
    } finally {
      setResolving(false);
    }
  }

  const canPromote = tally.majority === 'up' || (tally.majority === 'tie' && canResolveTie);
  const canArchive = tally.majority === 'down' || (tally.majority === 'tie' && canResolveTie);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        variant={myVote === 'up' ? 'default' : 'outline'}
        size="sm"
        onClick={() => vote('up')}
        className="h-11 min-w-11"
      >
        {t('ideaVoting.up')} {tally.upCount}
      </Button>
      <Button
        type="button"
        variant={myVote === 'down' ? 'default' : 'outline'}
        size="sm"
        onClick={() => vote('down')}
        className="h-11 min-w-11"
      >
        {t('ideaVoting.down')} {tally.downCount}
      </Button>
      <span className="text-muted-foreground">{t('ideaVoting.votesCount', { votes: tally.totalVotes, total: totalMembers })}</span>
      {tally.majority === 'tie' && !canResolveTie && (
        <span className="text-muted-foreground">{t('ideaVoting.tieAdminOnly')}</span>
      )}
      {canPromote && (
        <button
          type="button"
          onClick={() => void resolve('active')}
          disabled={resolving}
          className="text-primary hover:underline disabled:opacity-50"
        >
          {t('ideaVoting.promote')}
        </button>
      )}
      {canArchive && (
        <button
          type="button"
          onClick={() => void resolve('archived')}
          disabled={resolving}
          className="text-muted-foreground hover:underline disabled:opacity-50"
        >
          {t('ideaVoting.archiveVote')}
        </button>
      )}
    </div>
  );
}
