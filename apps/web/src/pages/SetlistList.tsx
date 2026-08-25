// SPDX-License-Identifier: Apache-2.0
import { can, createSetlist, getSetlistStats, itemsKey } from '@bandstand/core';
import type { BandRole, Setlist, SetlistItem, SetlistViewMode, Song } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { useBandDoc } from '../hooks/useBandDoc';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import type * as Y from 'yjs';

function formatDuration(t: (key: string, opts?: Record<string, unknown>) => string, totalSec: number): string {
  return t('setlistList.durationMinutes', { minutes: Math.round(totalSec / 60) });
}

function DeleteSetlistButton({ bandId, setlistId, setlistName }: { bandId: string; setlistId: string; setlistName: string }) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(t('setlistList.confirmDelete', { name: setlistName }))) return;
    setDeleting(true);
    try {
      await apiClient.deleteSetlist(bandId, setlistId);
      // No local state update needed — the delete applies to the shared
      // Yjs doc server-side, and this client's own live connection to the
      // same doc reflects it as soon as the change syncs back.
    } catch {
      setDeleting(false);
    }
  }

  return (
    <button type="button" disabled={deleting} onClick={() => void handleDelete()} className="text-xs text-destructive hover:underline">
      {t('setlistList.delete')}
    </button>
  );
}

function SetlistCard({
  doc,
  bandId,
  setlistId,
  setlist,
  songs,
  variant,
  canDelete,
}: {
  doc: Y.Doc;
  bandId: string;
  setlistId: string;
  setlist: Setlist;
  songs: Record<string, Song>;
  variant: 'list' | 'board';
  canDelete: boolean;
}) {
  const { t } = useTranslation();
  const items = useYArray<SetlistItem>(doc.getArray(itemsKey(setlistId)));
  const stats = getSetlistStats(items, songs);
  const statsText = t('setlistList.stats', { count: stats.songCount, duration: formatDuration(t, stats.totalDurationSec) });

  if (variant === 'list') {
    return (
      <li className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p>{setlist.name}</p>
          <p className="text-xs text-muted-foreground">{statsText}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="text-sm text-primary hover:underline">
            {t('setlistList.open')}
          </Link>
          {canDelete && <DeleteSetlistButton bandId={bandId} setlistId={setlistId} setlistName={setlist.name} />}
        </div>
      </li>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{setlist.name}</p>
        <div className="flex items-center gap-3">
          <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="text-sm text-primary hover:underline">
            {t('setlistList.open')}
          </Link>
          {canDelete && <DeleteSetlistButton bandId={bandId} setlistId={setlistId} setlistName={setlist.name} />}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{statsText}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="truncate">
            <Link
              to={`/bands/${bandId}/setlists/${setlistId}/stage/${item.id}`}
              className="text-muted-foreground hover:text-primary hover:underline"
            >
              {item.type === 'song'
                ? (songs[item.songId]?.title ?? item.songId)
                : item.type === 'break'
                  ? t('setlistDetail.breakMinutes', { minutes: item.breakMinutes })
                  : t('setlistDetail.finale')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SetlistList() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc, status } = useBandDoc(bandId ?? null);
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const [name, setName] = useState('');
  const [viewMode, setViewMode] = useState<SetlistViewMode>('list');
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const isWideScreen = useIsWideScreen();
  const effectiveViewMode: SetlistViewMode = isWideScreen ? viewMode : 'list';
  const canDelete = viewerRole ? can(viewerRole, 'setlist:delete') : false;

  useEffect(() => {
    apiClient.getMyPrefs().then((prefs) => setViewMode(prefs.setlistViewMode));
  }, []);

  useEffect(() => {
    if (!bandId) return;
    apiClient.listMyBands().then((bands) => {
      setViewerRole(bands.find((b) => b.id === bandId)?.role ?? null);
    });
  }, [bandId]);

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!doc || !name.trim()) return;
    createSetlist(doc, name.trim());
    setName('');
  }

  function toggleViewMode() {
    const next: SetlistViewMode = viewMode === 'board' ? 'list' : 'board';
    setViewMode(next);
    apiClient.updateMyPrefs({ setlistViewMode: next }).catch(() => {});
  }

  if (!bandId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;
  const entries = Object.entries(setlists);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
        &larr; {t('setlistList.back')}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('setlistList.title')}</h1>
        {isWideScreen && (
          <Button type="button" variant="outline" onClick={toggleViewMode}>
            {viewMode === 'board' ? t('setlistList.listView') : t('setlistList.boardView')}
          </Button>
        )}
      </div>

      <form onSubmit={handleCreate} className="mt-4 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('setlistList.newPlaceholder')}
          className="w-64"
        />
        <Button type="submit" disabled={!name.trim()}>
          {t('setlistList.create')}
        </Button>
      </form>

      {entries.length === 0 || !doc ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('setlistList.noSetlists')}</p>
      ) : effectiveViewMode === 'board' ? (
        <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
          {entries.map(([setlistId, setlist]) => (
            <SetlistCard
              key={setlistId}
              doc={doc}
              bandId={bandId}
              setlistId={setlistId}
              setlist={setlist}
              songs={songs}
              variant="board"
              canDelete={canDelete}
            />
          ))}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {entries.map(([setlistId, setlist]) => (
            <SetlistCard
              key={setlistId}
              doc={doc}
              bandId={bandId}
              setlistId={setlistId}
              setlist={setlist}
              songs={songs}
              variant="list"
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
