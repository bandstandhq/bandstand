// SPDX-License-Identifier: Apache-2.0
import { can, createSetlist, getSetlistStats, itemsKey } from '@bandstand/core';
import type { BandRole, Setlist, SetlistItem, SetlistViewMode, Song } from '@bandstand/core';
import { Button, Form, FormControl, FormField, FormItem, Input, useConfirmDialog } from '@bandstand/ui';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageShell } from '../components/PageShell';
import { BandAccessDenied } from '../components/BandAccessDenied';
import { useBandDoc } from '../hooks/useBandDoc';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useYArray } from '../hooks/useYArray';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { formatSetlistDuration } from '../lib/formatSetlistDuration';
import type * as Y from 'yjs';

function DeleteSetlistButton({ bandId, setlistId, setlistName }: { bandId: string; setlistId: string; setlistName: string }) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = await confirm({
      title: t('setlistList.confirmDelete', { name: setlistName }),
      confirmLabel: t('setlistList.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
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
    <button
      type="button"
      disabled={deleting}
      onClick={() => void handleDelete()}
      aria-label={t('setlistList.delete')}
      title={t('setlistList.delete')}
      className="flex h-11 w-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      <Trash2 className="h-5 w-5" aria-hidden="true" />
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
  const statsText = t('setlistList.stats', { count: stats.songCount, duration: formatSetlistDuration(t, stats.totalDurationSec) });

  if (variant === 'list') {
    return (
      <li className="relative flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50">
        {/* Stretched-link pattern: this covers the whole row (its
            containing block is the `relative` <li> above, not this <div>)
            so the entire row opens the setlist, while the visible "Open"
            link and delete button — each given `relative` below — stay on
            top and independently clickable/tabbable, per normal DOM-order
            stacking. */}
        <Link
          to={`/bands/${bandId}/setlists/${setlistId}`}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={t('setlistList.openAria', { name: setlist.name })}
        />
        <div className="min-w-0">
          <p className="wrap-break-word">{setlist.name}</p>
          <p className="text-xs text-muted-foreground">{statsText}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="relative text-sm text-primary hover:underline">
            {t('setlistList.open')}
          </Link>
          {canDelete && (
            <span className="relative">
              <DeleteSetlistButton bandId={bandId} setlistId={setlistId} setlistName={setlist.name} />
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="relative w-72 flex-shrink-0 rounded-md border border-border p-3 hover:bg-accent/50 focus-within:bg-accent/50">
      <Link
        to={`/bands/${bandId}/setlists/${setlistId}`}
        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t('setlistList.openAria', { name: setlist.name })}
      />
      <div className="flex items-center justify-between">
        <p className="relative font-medium">{setlist.name}</p>
        <div className="flex items-center gap-3">
          <Link to={`/bands/${bandId}/setlists/${setlistId}`} className="relative text-sm text-primary hover:underline">
            {t('setlistList.open')}
          </Link>
          {canDelete && (
            <span className="relative">
              <DeleteSetlistButton bandId={bandId} setlistId={setlistId} setlistName={setlist.name} />
            </span>
          )}
        </div>
      </div>
      <p className="relative text-xs text-muted-foreground">{statsText}</p>
      <ul className="relative mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="truncate">
            <Link
              to={`/bands/${bandId}/setlists/${setlistId}/stage/${item.id}`}
              className="relative text-muted-foreground hover:text-primary hover:underline"
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
  const createSetlistForm = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const newSetlistName = useWatch({ control: createSetlistForm.control, name: 'name' });
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

  function handleCreate(values: { name: string }) {
    if (!doc || !values.name.trim()) return;
    createSetlist(doc, values.name.trim());
    createSetlistForm.reset();
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
    <PageShell title={t('setlistList.title')}>
      {/* Hidden on mobile: BottomNav's own Dashboard tab already covers this there. */}
      <Link to="/dashboard" className="mt-4 hidden text-sm text-muted-foreground hover:underline sm:inline-block">
        &larr; {t('setlistList.back')}
      </Link>

      <div className="mt-4 flex items-center justify-end">
        {isWideScreen && (
          <Button type="button" variant="outline" onClick={toggleViewMode}>
            {viewMode === 'board' ? t('setlistList.listView') : t('setlistList.boardView')}
          </Button>
        )}
      </div>

      <Form {...createSetlistForm}>
        <form
          onSubmit={createSetlistForm.handleSubmit(handleCreate)}
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <FormField
            control={createSetlistForm.control}
            name="name"
            render={({ field }) => (
              <FormItem className="contents">
                <FormControl>
                  <Input placeholder={t('setlistList.newPlaceholder')} className="w-full sm:w-64" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={!doc || !newSetlistName.trim()}>
            {t('setlistList.create')}
          </Button>
          {/* Without this, tapping Create while the band doc hasn't loaded yet
              (a slower or just-reconnecting mobile connection) silently did
              nothing — handleCreate's own `!doc` guard bailed with no
              indication why, indistinguishable from the button being broken. */}
          {!doc && <p className="text-sm text-muted-foreground">{t('setlistList.waitingForConnection')}</p>}
        </form>
      </Form>

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
    </PageShell>
  );
}
