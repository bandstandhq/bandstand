// SPDX-License-Identifier: Apache-2.0
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addSetlistItem,
  buildBreakItem,
  buildFinaleItem,
  buildSongItem,
  getSetlistStats,
  itemsKey,
  moveSetlistItem,
  removeSetlistItem,
} from '@bandstand/core';
import type { Setlist, SetlistItem, Song } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { useBandDoc } from '../hooks/useBandDoc';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { formatSetlistDuration } from '../lib/formatSetlistDuration';

const SETLIST_DROP_ZONE_ID = 'setlist-drop-zone';

/** Shared by the read-only row and the sortable (edit-mode) row. */
function getItemLabel(item: SetlistItem, song: Song | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return item.type === 'song'
    ? song
      ? `${song.title} — ${song.artist}`
      : item.songId
    : item.type === 'break'
      ? t('setlistDetail.breakMinutes', { minutes: item.breakMinutes })
      : t('setlistDetail.finale');
}

function SetlistDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: SETLIST_DROP_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 min-h-24 rounded-md border border-dashed p-2 ${isOver ? 'border-primary' : 'border-border'}`}
    >
      {children}
    </div>
  );
}

function PoolSongCard({ songId, song }: { songId: string; song: Song }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${songId}`,
    data: { type: 'pool-song', songId },
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded-md border border-border p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      {song.title} <span className="text-muted-foreground">— {song.artist}</span>
    </li>
  );
}

function SortableSetlistItem({
  bandId,
  setlistId,
  item,
  song,
  onRemove,
}: {
  bandId: string;
  setlistId: string;
  item: SetlistItem;
  song: Song | undefined;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: 'setlist-item' },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between rounded-md border border-border p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Doubles as the drag handle and the tap target for Stage Mode — a
          plain tap (no pointer movement past dnd-kit's activation
          distance) reaches Stage Mode; a drag reorders. Previously only the
          small separate "Play" link (now removed) navigated at all, so
          tapping the row itself did nothing. */}
      <Link
        to={`/bands/${bandId}/setlists/${setlistId}/stage/${item.id}`}
        {...attributes}
        {...listeners}
        className="flex-1 cursor-grab rounded-md px-1 py-1.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {getItemLabel(item, song, t)}
      </Link>
      <button type="button" onClick={onRemove} className="text-xs text-muted-foreground hover:underline">
        {t('setlistDetail.remove')}
      </button>
    </li>
  );
}

/**
 * The read view's row — no drag handle, no remove button, nothing but the
 * label and a tap target into Stage Mode. This is the "calm" view a
 * musician checks right before playing; edit-only affordances belong in
 * `SortableSetlistItem` instead, never here.
 */
function ReadOnlyItemRow({
  bandId,
  setlistId,
  item,
  song,
}: {
  bandId: string;
  setlistId: string;
  item: SetlistItem;
  song: Song | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li className="rounded-md border border-border text-sm">
      <Link
        to={`/bands/${bandId}/setlists/${setlistId}/stage/${item.id}`}
        className="block rounded-md px-2 py-2 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {getItemLabel(item, song, t)}
      </Link>
    </li>
  );
}

export function SetlistDetail() {
  const { t } = useTranslation();
  const { bandId, setlistId } = useParams<{ bandId: string; setlistId: string }>();
  const { doc, status } = useBandDoc(bandId ?? null);
  const songs = useYMap<Song>(doc?.getMap('songs'));
  const setlists = useYMap<Setlist>(doc?.getMap('setlists'));
  const items = useYArray<SetlistItem>(setlistId ? doc?.getArray(itemsKey(setlistId)) : undefined);

  // Never persisted (not even per-user) — a setlist always opens read-only,
  // the calm view someone needs right before playing; editing is a
  // deliberate, one-tap-away, per-visit choice, not a sticky mode.
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!bandId || !setlistId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;
  const setlist = setlists[setlistId];
  const poolSongs = Object.entries(songs).filter(([, song]) => song.status === 'active');
  const stats = getSetlistStats(items, songs);
  const statsText = t('setlistList.stats', { count: stats.songCount, duration: formatSetlistDuration(t, stats.totalDurationSec) });

  function handleDragEnd(event: DragEndEvent) {
    if (!doc || !setlistId) return;
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { type?: string; songId?: string } | undefined;

    if (activeData?.type === 'pool-song' && activeData.songId) {
      addSetlistItem(doc, setlistId, buildSongItem(activeData.songId));
      return;
    }

    if (activeData?.type === 'setlist-item' && over.id !== active.id) {
      const overIndex = items.findIndex((item) => item.id === over.id);
      if (overIndex === -1) return;
      moveSetlistItem(doc, setlistId, String(active.id), overIndex);
    }
  }

  function handleAddBreak() {
    if (doc && setlistId) addSetlistItem(doc, setlistId, buildBreakItem(15));
  }

  function handleAddFinale() {
    if (doc && setlistId) addSetlistItem(doc, setlistId, buildFinaleItem());
  }

  function handleRemove(itemId: string) {
    if (doc && setlistId) removeSetlistItem(doc, setlistId, itemId);
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Link to={`/bands/${bandId}/setlists`} className="text-sm text-muted-foreground hover:underline">
        &larr; {t('setlistDetail.back')}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{setlist?.name}</h1>
          <p className="text-sm text-muted-foreground">{statsText}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>
          {mode === 'edit' ? t('setlistDetail.doneEditing') : t('setlistDetail.editMode')}
        </Button>
      </div>

      {mode === 'view' ? (
        <div className="mt-6">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('setlistDetail.itemsEmptyReadOnly')}</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => (
                <ReadOnlyItemRow
                  key={item.id}
                  bandId={bandId}
                  setlistId={setlistId}
                  item={item}
                  song={item.type === 'song' ? songs[item.songId] : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{t('setlistDetail.pool')}</h2>
              <p className="text-xs text-muted-foreground">{t('setlistDetail.poolHint')}</p>
              {poolSongs.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('setlistDetail.poolEmpty')}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {poolSongs.map(([songId, song]) => (
                    <PoolSongCard key={songId} songId={songId} song={song} />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">{t('setlistDetail.items')}</h2>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={handleAddBreak}>
                    {t('setlistDetail.addBreak')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={handleAddFinale}>
                    {t('setlistDetail.addFinale')}
                  </Button>
                </div>
              </div>
              <SetlistDropZone>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('setlistDetail.itemsEmpty')}</p>
                ) : (
                  <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <SortableSetlistItem
                          key={item.id}
                          bandId={bandId}
                          setlistId={setlistId}
                          item={item}
                          song={item.type === 'song' ? songs[item.songId] : undefined}
                          onRemove={() => handleRemove(item.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                )}
              </SetlistDropZone>
            </div>
          </div>
        </DndContext>
      )}
    </main>
  );
}
