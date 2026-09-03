// SPDX-License-Identifier: Apache-2.0
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addSetlistItem,
  buildBreakItem,
  buildFinaleItem,
  buildSongItem,
  getSetlistStats,
  insertSetlistItem,
  itemsKey,
  moveSetlistItem,
  removeSetlistItem,
} from '@bandstand/core';
import type { Setlist, SetlistItem, Song } from '@bandstand/core';
import { Button } from '@bandstand/ui';
import { GripVertical, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
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

function PoolSongCard({ songId, song, onAdd }: { songId: string; song: Song; onAdd: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${songId}`,
    data: { type: 'pool-song', songId },
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      <span
        {...listeners}
        {...attributes}
        data-testid="pool-drag-handle"
        aria-label={t('setlistDetail.dragHandle', { name: song.title })}
        // Confined to this small handle, not the whole row (see
        // SortableSetlistItem's identical reasoning below): without this, a
        // touch press here can't be told apart from the start of a page
        // scroll — the browser's own scroll gesture wins almost every time
        // before TouchSensor's activation delay elapses, so a drag from the
        // pool never actually starts on a touchscreen. Confining it to just
        // the handle (not the label text next to it) is what lets a finger
        // starting anywhere else on this row still scroll the page normally.
        // See docs/adr/0014-no-native-drag-on-interactive-rows.md.
        style={{ touchAction: 'none' }}
        className="flex h-11 w-10 shrink-0 cursor-grab items-center justify-center text-muted-foreground"
      >
        <GripVertical className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="flex-1 py-1">
        {song.title} <span className="text-muted-foreground">— {song.artist}</span>
      </span>
      {/* Dragging has no keyboard equivalent for "add from an external
          list" (dnd-kit's keyboard sensor only reorders *within* a
          SortableContext, which the pool isn't part of) — this button is
          the keyboard/screen-reader path onto the end of the setlist;
          reordering it into place from there uses the setlist's own
          keyboard-accessible sortable reordering. */}
      <button
        type="button"
        onClick={onAdd}
        className="flex h-11 shrink-0 items-center rounded-md px-2 text-xs text-primary hover:bg-accent/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('setlistDetail.addToEnd')}
      </button>
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

  // dnd-kit's own document-level click guard (added the moment a drag
  // activates, meant to eat the click that a mousedown+mousemove+mouseup
  // cycle would otherwise fire on the handle) only calls stopPropagation()
  // on that click, never preventDefault() — see AbstractPointerSensor's
  // handleStart() in @dnd-kit/core. That stops the click from reaching
  // React (so React Router's own navigate() never runs), but does nothing
  // to the browser's native default action for a real <a>: without an
  // explicit preventDefault(), it still navigates. On top of that, dnd-kit
  // removes its own guard on a hardcoded 50ms timer regardless of whether
  // the click has arrived yet, so under enough main-thread contention (an
  // older tablet, not just a busy dev machine) the click can arrive after
  // the guard is already gone. Either way, a completed drag on this row can
  // end in an unwanted navigation to Stage Mode.
  //
  // The fix has to run earlier than dnd-kit's own guard and call
  // preventDefault() itself. Capture-phase listeners fire top-down by DOM
  // position, not registration time, so a listener on the link itself would
  // still run after dnd-kit's (document is visited before any of its
  // descendants) — it has to sit on `document` too, and be registered once,
  // at mount, well before any drag can ever start, so it's first in
  // attachment order among same-node listeners. See
  // docs/adr/0014-no-native-drag-on-interactive-rows.md.
  const suppressNextClickRef = useRef(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  useDndMonitor({
    onDragStart(event) {
      if (event.active.id === item.id) suppressNextClickRef.current = true;
    },
  });
  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      if (suppressNextClickRef.current && linkRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        suppressNextClickRef.current = false;
      }
    };
    document.addEventListener('click', onClickCapture, { capture: true });
    return () => document.removeEventListener('click', onClickCapture, { capture: true });
  }, []);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 justify-between rounded-md border border-border p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* A dedicated grip, not the whole row (see PoolSongCard's identical
          reasoning) — this is the only part of the row that's draggable, so
          a finger starting a scroll swipe anywhere over the label itself
          isn't fighting dnd-kit's touch-action:none for it. */}
      <span
        {...attributes}
        {...listeners}
        aria-label={t('setlistDetail.dragHandle', { name: getItemLabel(item, song, t) })}
        style={{ touchAction: 'none' }}
        className="flex h-11 w-10 shrink-0 cursor-grab items-center justify-center text-muted-foreground"
      >
        <GripVertical className="h-6 w-6" aria-hidden="true" />
      </span>
      {/* The tap target for Stage Mode — a plain tap reaches it; dragging now
          only ever starts from the handle above, never from here.
          `draggable={false}` is load-bearing, not decorative: an <a> is
          natively draggable by default, and the browser's own drag
          recognition runs independently of dnd-kit's pointer tracking. */}
      <Link
        ref={linkRef}
        to={`/bands/${bandId}/setlists/${setlistId}/stage/${item.id}`}
        draggable={false}
        onPointerDown={() => {
          // A fresh gesture starting — any suppression armed by a previous
          // drag that never got the click it was waiting for is stale now.
          suppressNextClickRef.current = false;
        }}
        className="flex min-h-11 flex-1 items-center rounded-md px-1 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {getItemLabel(item, song, t)}
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('setlistDetail.remove')}
        title={t('setlistDetail.remove')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-5 w-5" aria-hidden="true" />
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
        className="flex min-h-11 items-center rounded-md px-2 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {getItemLabel(item, song, t)}
      </Link>
    </li>
  );
}

/** The insertion-point indicator shown while dragging a pool song over the setlist. */
function InsertionMarker() {
  return (
    <li aria-hidden className="my-0.5 h-1 rounded-full bg-primary" data-testid="setlist-insertion-marker" />
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

  // Where a song dragged from the pool would land if dropped right now —
  // purely a rendering concern (drives `InsertionMarker`'s position), never
  // fed into dnd-kit's own sortable machinery. `null` means no pool-song
  // drag is in progress.
  const [poolDragOverIndex, setPoolDragOverIndex] = useState<number | null>(null);

  // Mouse (distance-based, immediate) and touch (delay-based) are separate
  // sensors — a single distance-based PointerSensor would hijack a normal
  // touch-scroll gesture the moment it moved past the activation distance.
  // KeyboardSensor makes the setlist's own items reorderable via arrow keys
  // once one is focused (dnd-kit's built-in behavior for a SortableContext);
  // there's no keyboard equivalent for *adding from the pool* via drag, so
  // PoolSongCard has its own explicit "add to end" button for that instead.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!bandId || !setlistId) return null;
  if (status === 'forbidden') return <BandAccessDenied />;
  const setlist = setlists[setlistId];
  const poolSongs = Object.entries(songs).filter(([, song]) => song.status === 'active');
  const stats = getSetlistStats(items, songs);
  const statsText = t('setlistList.stats', { count: stats.songCount, duration: formatSetlistDuration(t, stats.totalDurationSec) });

  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === 'pool-song') setPoolDragOverIndex(items.length);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (active.data.current?.type !== 'pool-song' || !over) return;
    if (over.id === SETLIST_DROP_ZONE_ID) {
      setPoolDragOverIndex(items.length);
      return;
    }
    const overIndex = items.findIndex((item) => item.id === over.id);
    if (overIndex !== -1) setPoolDragOverIndex(overIndex);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeData = active.data.current as { type?: string; songId?: string } | undefined;
    const dropIndex = poolDragOverIndex;
    setPoolDragOverIndex(null);
    if (!doc || !setlistId || !over) return;

    if (activeData?.type === 'pool-song' && activeData.songId) {
      insertSetlistItem(doc, setlistId, buildSongItem(activeData.songId), dropIndex ?? items.length);
      return;
    }

    if (activeData?.type === 'setlist-item' && over.id !== active.id) {
      const overIndex = items.findIndex((item) => item.id === over.id);
      if (overIndex === -1) return;
      moveSetlistItem(doc, setlistId, String(active.id), overIndex);
    }
  }

  function handleDragCancel() {
    setPoolDragOverIndex(null);
  }

  function handleAddToEnd(songId: string) {
    if (doc && setlistId) addSetlistItem(doc, setlistId, buildSongItem(songId));
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
    <PageShell title={setlist?.name}>
      <Link to={`/bands/${bandId}/setlists`} className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
        &larr; {t('setlistDetail.back')}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{statsText}</p>
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
        <DndContext
          sensors={sensors}
          // rectIntersection, not closestCenter: closestCenter always
          // resolves `over` to *some* droppable — nearest-by-distance, even
          // when the pointer isn't actually above any of them — so dropping
          // back over the pool (which has no droppable of its own) still
          // landed on whichever setlist droppable happened to be nearest,
          // silently adding the song anyway. rectIntersection only reports a
          // droppable the dragged rect genuinely overlaps, so releasing
          // outside every droppable correctly yields `over: null`.
          collisionDetection={rectIntersection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{t('setlistDetail.pool')}</h2>
              <p className="text-xs text-muted-foreground">{t('setlistDetail.poolHint')}</p>
              {/* An unloaded doc (`songs` reads as {}) must never look like
                  "no active songs" — a slower mobile connection would make a
                  real repertoire look wiped, not just not-yet-ready. */}
              {!doc ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('setlistDetail.waitingForConnection')}</p>
              ) : poolSongs.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('setlistDetail.poolEmpty')}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {poolSongs.map(([songId, song]) => (
                    <PoolSongCard key={songId} songId={songId} song={song} onAdd={() => handleAddToEnd(songId)} />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">{t('setlistDetail.items')}</h2>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={!doc} onClick={handleAddBreak}>
                    {t('setlistDetail.addBreak')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!doc} onClick={handleAddFinale}>
                    {t('setlistDetail.addFinale')}
                  </Button>
                </div>
              </div>
              <SetlistDropZone>
                {items.length === 0 && poolDragOverIndex === null ? (
                  <p className="text-sm text-muted-foreground">{t('setlistDetail.itemsEmpty')}</p>
                ) : (
                  <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      {items.map((item, index) => (
                        <Fragment key={item.id}>
                          {poolDragOverIndex === index && <InsertionMarker />}
                          <SortableSetlistItem
                            bandId={bandId}
                            setlistId={setlistId}
                            item={item}
                            song={item.type === 'song' ? songs[item.songId] : undefined}
                            onRemove={() => handleRemove(item.id)}
                          />
                        </Fragment>
                      ))}
                      {poolDragOverIndex === items.length && <InsertionMarker />}
                    </ul>
                  </SortableContext>
                )}
                {/* A dedicated, generously-sized "append to the end" target —
                    without it, that action's actual hit area was whatever
                    sliver of SetlistDropZone's own padding sat below the
                    last item (often none once items filled the container),
                    while "insert before the first item" had that whole
                    item's rect to land on. This belongs to the drop zone,
                    not to any sortable item, so hovering it resolves
                    `over.id` to SETLIST_DROP_ZONE_ID — see handleDragOver. */}
                {items.length > 0 && <div className="h-16" aria-hidden="true" />}
              </SetlistDropZone>
            </div>
          </div>
        </DndContext>
      )}
    </PageShell>
  );
}
