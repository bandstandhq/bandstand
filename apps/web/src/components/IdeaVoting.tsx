// SPDX-License-Identifier: Apache-2.0
import { castVote, getIdeaVoteTally, setSongStatus } from '@bandstand/core';
import type { Song, Vote } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';

export function IdeaVoting({
  doc,
  songId,
  song,
  currentUserId,
  totalMembers,
  isAdmin,
}: {
  doc: Y.Doc;
  songId: string;
  song: Song;
  currentUserId: string;
  totalMembers: number;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const tally = getIdeaVoteTally(song, totalMembers);
  const myVote = song.votes[currentUserId];

  function vote(value: Vote) {
    castVote(doc, songId, currentUserId, value);
  }

  function resolve(status: 'active' | 'archived') {
    setSongStatus(doc, songId, status);
  }

  const canPromote = tally.majority === 'up' || (tally.majority === 'tie' && isAdmin);
  const canArchive = tally.majority === 'down' || (tally.majority === 'tie' && isAdmin);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        variant={myVote === 'up' ? 'default' : 'outline'}
        size="sm"
        onClick={() => vote('up')}
      >
        {t('ideaVoting.up')} {tally.upCount}
      </Button>
      <Button
        type="button"
        variant={myVote === 'down' ? 'default' : 'outline'}
        size="sm"
        onClick={() => vote('down')}
      >
        {t('ideaVoting.down')} {tally.downCount}
      </Button>
      <span className="text-muted-foreground">{t('ideaVoting.votesCount', { votes: tally.totalVotes, total: totalMembers })}</span>
      {tally.majority === 'tie' && !isAdmin && (
        <span className="text-muted-foreground">{t('ideaVoting.tieAdminOnly')}</span>
      )}
      {canPromote && (
        <button type="button" onClick={() => resolve('active')} className="text-primary hover:underline">
          {t('ideaVoting.promote')}
        </button>
      )}
      {canArchive && (
        <button type="button" onClick={() => resolve('archived')} className="text-muted-foreground hover:underline">
          {t('ideaVoting.archiveVote')}
        </button>
      )}
    </div>
  );
}
