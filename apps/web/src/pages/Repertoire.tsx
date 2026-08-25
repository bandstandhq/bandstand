// SPDX-License-Identifier: Apache-2.0
import type { BandMember } from '@bandstand/core';
import { archiveSong, can, restoreSong } from '@bandstand/core';
import type { Song, SongStatus } from '@bandstand/core';
import { normalizeKey } from '@bandstand/chords';
import { Button, Dialog, Input } from '@bandstand/ui';
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

type ActiveStatusFilter = 'all' | Extract<SongStatus, 'idea' | 'active'>;
type RepertoireView = 'active' | 'archive';

export function Repertoire() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc, status } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const [view, setView] = useState<RepertoireView>('active');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>('all');
  const [members, setMembers] = useState<BandMember[]>([]);
  const [importedMessage, setImportedMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ songId: string; song: Song } | null>(null);
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
  const canDeleteForever = myRole ? can(myRole, 'song:deleteForever') : false;

  const songEntries = Object.entries(songs);
  const activeEntries = songEntries.filter(([, song]) => song.status !== 'archived');
  const archivedEntries = songEntries.filter(([, song]) => song.status === 'archived');
  const currentEntries = view === 'active' ? activeEntries : archivedEntries;

  const query = search.trim().toLowerCase();
  const filtered = currentEntries.filter(([, song]) => {
    if (view === 'active' && statusFilter !== 'all' && song.status !== statusFilter) return false;
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

      <div className="mt-4 flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setView('active')}
          className={`px-3 py-2 text-sm ${view === 'active' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
        >
          {t('repertoire.tabActive')}
        </button>
        <button
          type="button"
          onClick={() => setView('archive')}
          className={`px-3 py-2 text-sm ${view === 'archive' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
        >
          {t('repertoire.tabArchive', { count: archivedEntries.length })}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('repertoire.searchPlaceholder')}
          className="w-72"
        />
        {view === 'active' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ActiveStatusFilter)}
            aria-label={t('repertoire.statusFilter')}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">{t('repertoire.statusAll')}</option>
            <option value="idea">{t('repertoire.statusIdea')}</option>
            <option value="active">{t('repertoire.statusActive')}</option>
          </select>
        )}
      </div>

      {currentEntries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {view === 'active' ? t('repertoire.noSongsAtAll') : t('repertoire.noArchivedSongs')}
        </p>
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
                    {view === 'archive' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRestore(songId)}
                          className="text-sm text-primary hover:underline"
                        >
                          {t('repertoire.restore')}
                        </button>
                        {canDeleteForever && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ songId, song })}
                            className="text-sm text-destructive hover:underline"
                          >
                            {t('repertoire.deleteForever.action')}
                          </button>
                        )}
                      </>
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
                {view === 'active' && song.status === 'idea' && doc && currentUserId && bandId && (
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

      {bandId && deleteTarget && (
        <DeleteSongForeverDialog
          bandId={bandId}
          songId={deleteTarget.songId}
          song={deleteTarget.song}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  );
}

function DeleteSongForeverDialog({
  bandId,
  songId,
  song,
  onClose,
}: {
  bandId: string;
  songId: string;
  song: Song;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [impact, setImpact] = useState<{ affectedSetlists: string[]; hasPersonalNotes: boolean } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getSongDeleteImpact(bandId, songId)
      .then(setImpact)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [bandId, songId]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiClient.deleteSongForever(bandId, songId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('repertoire.deleteForever.title', { title: song.title })}>
      {!impact && !error ? (
        <p className="text-sm text-muted-foreground">{t('repertoire.deleteForever.loading')}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{t('repertoire.deleteForever.warning')}</p>
          {impact && impact.affectedSetlists.length > 0 && (
            <p className="text-destructive">
              {t('repertoire.deleteForever.affectedSetlists', { setlists: impact.affectedSetlists.join(', ') })}
            </p>
          )}
          {impact?.hasPersonalNotes && <p className="text-destructive">{t('repertoire.deleteForever.hasNotes')}</p>}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              {t('repertoire.deleteForever.confirmLabel', { title: song.title })}
            </span>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full" autoFocus />
          </label>
          {error && <p className="text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('repertoire.deleteForever.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={confirmText !== song.title || deleting || !impact}
              onClick={() => void handleDelete()}
            >
              {deleting ? t('repertoire.deleteForever.deleting') : t('repertoire.deleteForever.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
