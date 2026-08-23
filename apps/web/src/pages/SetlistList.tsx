// SPDX-License-Identifier: Apache-2.0
import { createSetlist, getSetlistStats, itemsKey } from '@bandstand/core';
import type { Setlist, SetlistItem, SetlistViewMode, Song } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useBandDoc } from '../hooks/useBandDoc';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import type * as Y from 'yjs';

function formatDuration(t: (key: string, opts?: Record<string, unknown>) => string, totalSec: number): string {
  return t('setlistList.durationMinutes', { minutes: Math.round(totalSec / 60) });
}

function SetlistCard({
  doc,
  bandId,
  setlistId,
  setlist,
  songs,
  variant,
}: {
  doc: Y.Doc;
  bandId: string;
  setlistId: string;
  setlist: Setlist;
  songs: Record<string, Song>;
  variant: 'list' | 'board';
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
        <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="text-sm text-primary hover:underline">
          {t('setlistList.open')}
        </Link>
      </li>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{setlist.name}</p>
        <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="text-sm text-primary hover:underline">
          {t('setlistList.open')}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">{statsText}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="truncate text-muted-foreground">
            {item.type === 'song'
              ? (songs[item.songId]?.title ?? item.songId)
              : item.type === 'break'
                ? t('setlistDetail.breakMinutes', { minutes: item.breakMinutes })
                : t('setlistDetail.finale')}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SetlistList() {
  const { t } = useTranslation();
  const { bandId } = useParams<{ bandId: string }>();
  const { doc } = useBandDoc(bandId ?? null);
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const [name, setName] = useState('');
  const [viewMode, setViewMode] = useState<SetlistViewMode>('list');
  const isWideScreen = useIsWideScreen();
  const effectiveViewMode: SetlistViewMode = isWideScreen ? viewMode : 'list';

  useEffect(() => {
    apiClient.getMyPrefs().then((prefs) => setViewMode(prefs.setlistViewMode));
  }, []);

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
            />
          ))}
        </ul>
      )}
    </main>
  );
}
