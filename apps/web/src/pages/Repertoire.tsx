// SPDX-License-Identifier: Apache-2.0
import type { BandMember } from '@bandstand/core';
import { archiveSong, can, restoreSong } from '@bandstand/core';
import type { Song, SongStatus } from '@bandstand/core';
import { normalizeKey } from '@bandstand/chords';
import { Button, Input } from '@bandstand/ui';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { ExportRepertoire } from '../components/ExportRepertoire';
import { IdeaVoting } from '../components/IdeaVoting';
import { ImportSongs } from '../components/ImportSongs';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

type StatusFilter = 'all' | SongStatus;

export function Repertoire() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc, status } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [members, setMembers] = useState<BandMember[]>([]);
  const [importedMessage, setImportedMessage] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user.id;

  useEffect(() => {
    if (!bandId) return;
    apiClient.listBandMembers(bandId).then(setMembers);
  }, [bandId]);

  if (status === 'forbidden') {
    return <BandAccessDenied />;
  }

  const myRole = members.find((m) => m.userId === currentUserId)?.role;
  const canResolveTie = myRole ? can(myRole, 'idea:resolveTie') : false;

  const songEntries = Object.entries(songs);
  const query = search.trim().toLowerCase();
  const filtered = songEntries.filter(([, song]) => {
    if (statusFilter !== 'all' && song.status !== statusFilter) return false;
    if (!query) return true;
    return (
      song.title.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query) ||
      song.key.toLowerCase().includes(query)
    );
  });

  function handleArchive(songId: string) {
    if (doc) archiveSong(doc, songId);
  }

  function handleRestore(songId: string) {
    if (doc) restoreSong(doc, songId);
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
        &larr; {t('repertoire.back')}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('repertoire.title')}</h1>
        <div className="flex gap-2">
          {doc && <ExportRepertoire doc={doc} />}
          {doc && (
            <ImportSongs
              doc={doc}
              onImported={(count) => {
                setImportedMessage(t('chordProImport.imported', { count }));
                setTimeout(() => setImportedMessage(null), 4000);
              }}
            />
          )}
          <Link to={`/bands/${bandId}/songs/new`}>
            <Button>{t('repertoire.newSong')}</Button>
          </Link>
        </div>
      </div>
      {importedMessage && <p className="mt-2 text-sm text-primary">{importedMessage}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('repertoire.searchPlaceholder')}
          className="w-72"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label={t('repertoire.statusFilter')}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="all">{t('repertoire.statusAll')}</option>
          <option value="idea">{t('repertoire.statusIdea')}</option>
          <option value="active">{t('repertoire.statusActive')}</option>
          <option value="archived">{t('repertoire.statusArchived')}</option>
        </select>
      </div>

      {songEntries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('repertoire.noSongsAtAll')}</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('repertoire.noSongs')}</p>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-4">{t('repertoire.columnTitle')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnArtist')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnKey')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnStatus')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(([songId, song]) => (
              <Fragment key={songId}>
                <tr className="border-t border-border">
                  <td className="py-1 pr-4">{song.title}</td>
                  <td className="py-1 pr-4">{song.artist}</td>
                  <td className="py-1 pr-4">{normalizeKey(song.key)}</td>
                  <td className="py-1 pr-4">{song.status}</td>
                  <td className="space-x-3 py-1 text-right">
                    <Link to={`/bands/${bandId}/songs/${songId}/edit`} className="text-sm text-primary hover:underline">
                      {t('repertoire.edit')}
                    </Link>
                    {song.status === 'archived' ? (
                      <button
                        type="button"
                        onClick={() => handleRestore(songId)}
                        className="text-sm text-primary hover:underline"
                      >
                        {t('repertoire.restore')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleArchive(songId)}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        {t('repertoire.archive')}
                      </button>
                    )}
                  </td>
                </tr>
                {song.status === 'idea' && doc && currentUserId && bandId && (
                  <tr>
                    <td colSpan={5} className="pb-2">
                      <IdeaVoting
                        bandId={bandId}
                        doc={doc}
                        songId={songId}
                        song={song}
                        currentUserId={currentUserId}
                        totalMembers={members.length}
                        canResolveTie={canResolveTie}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
