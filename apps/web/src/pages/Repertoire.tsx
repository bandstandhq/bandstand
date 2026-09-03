// SPDX-License-Identifier: Apache-2.0
import type { BandMember } from '@bandstand/core';
import {
  archiveSong,
  can,
  getAnchorCalibrationProgress,
  getAssignedVoiceId,
  listAnchorsForSong,
  listVoicesForSong,
  restoreSong,
} from '@bandstand/core';
import type { Song, SongStatus } from '@bandstand/core';
import { buildRenderModel, normalizeKey, parseChordPro } from '@bandstand/chords';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@bandstand/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type * as Y from 'yjs';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { ExportRepertoire } from '../components/ExportRepertoire';
import { IdeaVoting } from '../components/IdeaVoting';
import { ImportSongs } from '../components/ImportSongs';
import { useBandDoc } from '../hooks/useBandDoc';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';

type ActiveStatusFilter = 'all' | Extract<SongStatus, 'idea'>;
type RepertoireView = 'active' | 'archive';

/** 'active' is the normal, unremarkable case and gets no visible label — only a suggestion or an archived song is worth calling out. */
function statusLabel(t: (key: string) => string, status: SongStatus): string {
  if (status === 'idea') return t('repertoire.statusIdea');
  if (status === 'archived') return t('repertoire.statusArchived');
  return '';
}

/**
 * "Before a gig it's clear where it's stuck" (see docs/adr/0010-anchor-sync.md)
 * — how many members' currently-assigned voice has every song anchor
 * calibrated. Nothing to show for a song with no anchors at all. Reads the
 * doc directly rather than subscribing to every song's own anchors:<songId>
 * array (one per song shown would mean many live subscriptions for a
 * secondary readiness hint) — refreshes with the rest of the row on the
 * `songs`/`voices`/`assignments` changes Repertoire already re-renders on.
 */
function AnchorReadiness({
  doc,
  songId,
  members,
}: {
  doc: Y.Doc;
  songId: string;
  members: BandMember[];
}) {
  const { t } = useTranslation();
  const anchors = listAnchorsForSong(doc, songId);
  if (anchors.length === 0 || members.length === 0) return null;

  const voices = listVoicesForSong(doc, songId);
  const perMember = members.map((member) => {
    const assignedVoiceId = getAssignedVoiceId(doc, songId, member.userId, member.instruments);
    const voice = voices.find((v) => v.id === assignedVoiceId)?.voice;
    if (!voice) return { member, progress: { done: 0, total: anchors.length } };
    const sections =
      voice.kind === 'chordpro' ? buildRenderModel(parseChordPro(voice.body)).sections : undefined;
    return { member, progress: getAnchorCalibrationProgress(voice, anchors, sections) };
  });

  const readyCount = perMember.filter(({ progress }) => progress.done === progress.total).length;
  const notReady = perMember
    .filter(({ progress }) => progress.done < progress.total)
    .map(({ member, progress }) => `${member.name}: ${progress.done}/${progress.total}`);

  return (
    <span
      className={`text-xs ${readyCount === members.length ? 'text-muted-foreground' : 'text-destructive'}`}
      title={notReady.length > 0 ? notReady.join(', ') : undefined}
    >
      {t('repertoire.anchorReadiness', { ready: readyCount, total: members.length })}
    </span>
  );
}

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
  // Renders either the table or its narrow-screen card equivalent, never
  // both — a CSS-only `hidden sm:table` / `sm:hidden` pair would put every
  // song title into the DOM twice, breaking any test (or screen reader)
  // that looks a song up by its accessible name without also picking which
  // variant it means.
  const isNarrowScreen = useMediaQuery('(max-width: 639px)');

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

  function renderRowActions(songId: string, song: Song) {
    return view === 'archive' ? (
      <>
        <button
          type="button"
          onClick={() => handleRestore(songId)}
          className="relative text-sm text-primary hover:underline"
        >
          {t('repertoire.restore')}
        </button>
        {canDeleteForever && (
          <button
            type="button"
            onClick={() => setDeleteTarget({ songId, song })}
            aria-label={t('repertoire.deleteForever.action')}
            title={t('repertoire.deleteForever.action')}
            className="relative -my-2.5 flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </>
    ) : (
      <button
        type="button"
        onClick={() => handleArchive(songId)}
        className="relative text-sm text-muted-foreground hover:underline"
      >
        {t('repertoire.archive')}
      </button>
    );
  }

  return (
    <PageShell title={t('repertoire.title')}>
      <Link to="/dashboard" className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('repertoire.back')}
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
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
          <Link
            to={`/bands/${bandId}/songs/new`}
            aria-label={t('repertoire.newSong')}
            title={t('repertoire.newSong')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {importedMessage && <p className="mt-2 text-sm text-primary">{importedMessage}</p>}

      {/* No "Active" tab: a song with no special status is the normal
          case and needs no label of its own — this row is just the
          search/filter controls, plus a single toggle into (and back out
          of) the archive rather than a pair of co-equal tabs. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {view === 'active' ? (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('repertoire.searchPlaceholder')}
              className="w-72"
            />
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ActiveStatusFilter)}>
              <SelectTrigger aria-label={t('repertoire.statusFilter')} className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('repertoire.statusAll')}</SelectItem>
                <SelectItem value="idea">{t('repertoire.statusIdea')}</SelectItem>
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setView('archive')}
              className="ml-auto text-sm text-muted-foreground hover:underline"
            >
              {t('repertoire.tabArchive', { count: archivedEntries.length })}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setView('active')} className="text-sm text-muted-foreground hover:underline">
            &larr; {t('repertoire.backToActive')}
          </button>
        )}
      </div>

      {currentEntries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {view === 'active' ? t('repertoire.noSongsAtAll') : t('repertoire.noArchivedSongs')}
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('repertoire.noSongs')}</p>
      ) : isNarrowScreen ? (
        <ul className="mt-6 space-y-3">
          {filtered.map(([songId, song]) => (
            <li key={songId} className="relative rounded-md border border-border p-3">
              <Link
                to={`/bands/${bandId}/songs/${songId}/play`}
                className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t('repertoire.playAria', { title: song.title })}
              />
              <div className="flex items-start justify-between gap-2">
                <p className="wrap-break-word font-medium">{song.title}</p>
                <Link
                  to={`/bands/${bandId}/songs/${songId}/edit`}
                  aria-label={t('repertoire.editAria', { title: song.title })}
                  className="relative -mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <p className="wrap-break-word text-sm text-muted-foreground">
                {[song.artist, normalizeKey(song.key), statusLabel(t, song.status)].filter(Boolean).join(' · ')}
              </p>
              {doc && (
                <p className="mt-1">
                  <AnchorReadiness doc={doc} songId={songId} members={members} />
                </p>
              )}
              <div className="relative mt-2 flex gap-4">{renderRowActions(songId, song)}</div>
              {view === 'active' && song.status === 'idea' && doc && currentUserId && bandId && (
                <div className="relative mt-2">
                  <IdeaVoting
                    bandId={bandId}
                    doc={doc}
                    songId={songId}
                    song={song}
                    currentUserId={currentUserId}
                    totalMembers={members.length}
                    canResolveTie={canResolveTie}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-4">{t('repertoire.columnTitle')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnArtist')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnKey')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnStatus')}</th>
              <th className="py-1 pr-4">{t('repertoire.columnAnchors')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(([songId, song]) => (
              <Fragment key={songId}>
                <tr className="relative border-t border-border hover:bg-accent/50 focus-within:bg-accent/50">
                  <td className="py-2 pr-4">
                    {/* Stretched-link pattern: its containing block is
                          this `relative` <tr>, so it covers the whole row —
                          the visible pencil icon and "Restore"/"Archive"/
                          "Delete forever" controls each get `relative` so
                          they stay on top and independently clickable, per
                          normal DOM-order stacking within the row. A row
                          plays the song (Stage Mode, no setlist) — editing
                          has its own explicit affordance, the pencil icon,
                          rather than being the row's default action. */}
                    <Link
                      to={`/bands/${bandId}/songs/${songId}/play`}
                      className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      aria-label={t('repertoire.playAria', { title: song.title })}
                    />
                    <span className="wrap-break-word">{song.title}</span>
                    <Link
                      to={`/bands/${bandId}/songs/${songId}/edit`}
                      aria-label={t('repertoire.editAria', { title: song.title })}
                      className="relative ml-1 inline-flex h-11 w-11 -translate-y-0.5 items-center justify-center align-middle text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </td>
                  <td className="py-2 pr-4 wrap-break-word">{song.artist}</td>
                  <td className="py-2 pr-4">{normalizeKey(song.key)}</td>
                  <td className="py-2 pr-4">{statusLabel(t, song.status)}</td>
                  <td className="py-2 pr-4">
                    {doc && <AnchorReadiness doc={doc} songId={songId} members={members} />}
                  </td>
                  <td className="space-x-3 py-2 text-right">{renderRowActions(songId, song)}</td>
                </tr>
                {view === 'active' && song.status === 'idea' && doc && currentUserId && bandId && (
                  <tr>
                    <td colSpan={6} className="pb-2">
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
    </PageShell>
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
  const [impact, setImpact] = useState<{
    affectedSetlists: string[];
    hasPersonalNotes: boolean;
  } | null>(null);
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('repertoire.deleteForever.title', { title: song.title })}</DialogTitle>
        </DialogHeader>
        {!impact && !error ? (
          <p className="text-sm text-muted-foreground">{t('repertoire.deleteForever.loading')}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>{t('repertoire.deleteForever.warning')}</p>
            {impact && impact.affectedSetlists.length > 0 && (
              <p className="text-destructive">
                {t('repertoire.deleteForever.affectedSetlists', {
                  setlists: impact.affectedSetlists.join(', '),
                })}
              </p>
            )}
            {impact?.hasPersonalNotes && (
              <p className="text-destructive">{t('repertoire.deleteForever.hasNotes')}</p>
            )}
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                {t('repertoire.deleteForever.confirmLabel', { title: song.title })}
              </span>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full"
                autoFocus
              />
            </label>
            {error && <p className="text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('repertoire.deleteForever.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={confirmText !== song.title || deleting || !impact}
                onClick={() => void handleDelete()}
              >
                {deleting
                  ? t('repertoire.deleteForever.deleting')
                  : t('repertoire.deleteForever.confirm')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
