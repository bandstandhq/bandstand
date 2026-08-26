// SPDX-License-Identifier: Apache-2.0
//
// A song's shared anchor list — "Intro", "Chorus", "Letter B", "bar 33" —
// owner/admin-authored, band-wide, and the thing every voice's position
// mapping (manual for `files`, auto-matched for `chordpro`) points into.
// See docs/adr/0010-anchor-sync.md.
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Anchor, BandRole } from '@bandstand/core';
import {
  anchorsKey,
  can,
  createAnchor,
  deleteAnchor,
  listVoicesForSong,
  matchAnchorsToChordProSections,
  reorderAnchors,
  updateAnchor,
} from '@bandstand/core';
import { buildRenderModel, parseChordPro } from '@bandstand/chords';
import { Button, Input } from '@bandstand/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { useYArray } from '../hooks/useYArray';
import { apiClient } from '../lib/api-client';

function SortableAnchorRow({
  anchor,
  matchesChordProSection,
  canEdit,
  onEdit,
  onDelete,
}: {
  anchor: Anchor;
  matchesChordProSection: boolean;
  canEdit: boolean;
  onEdit: (patch: Partial<Pick<Anchor, 'label' | 'bar' | 'timeMs'>>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: anchor.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border border-border p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      {canEdit && (
        <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
          ⠿
        </span>
      )}
      {canEdit ? (
        <Input
          value={anchor.label}
          onChange={(e) => onEdit({ label: e.target.value })}
          className="h-8 flex-1"
          aria-label={t('songAnchors.labelFor', { label: anchor.label })}
        />
      ) : (
        <span className="flex-1">{anchor.label}</span>
      )}
      {matchesChordProSection && (
        <span title={t('songAnchors.matchesSection')} className="text-xs text-muted-foreground">
          ✓
        </span>
      )}
      {canEdit && (
        <>
          <Input
            type="number"
            min={1}
            value={anchor.bar ?? ''}
            onChange={(e) => onEdit({ bar: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t('songAnchors.bar')}
            className="h-8 w-20"
            aria-label={t('songAnchors.barFor', { label: anchor.label })}
          />
          <button type="button" onClick={onDelete} className="text-xs text-muted-foreground hover:underline">
            {t('songAnchors.remove')}
          </button>
        </>
      )}
    </li>
  );
}

export function SongAnchors({ bandId, songId, doc }: { bandId: string; songId: string; doc: Y.Doc }) {
  const { t } = useTranslation();
  const [newLabel, setNewLabel] = useState('');
  const [viewerRole, setViewerRole] = useState<BandRole | null>(null);
  const anchors = useYArray<Anchor>(doc.getArray(anchorsKey(songId))).sort((a, b) => a.order - b.order);
  const canEdit = viewerRole ? can(viewerRole, 'anchor:edit') : false;

  useEffect(() => {
    apiClient.listMyBands().then((myBands) => {
      setViewerRole(myBands.find((b) => b.id === bandId)?.role ?? null);
    });
  }, [bandId]);

  const matchedSectionIds = useMemo(() => {
    const chordProVoice = listVoicesForSong(doc, songId).find(({ voice }) => voice.kind === 'chordpro');
    if (!chordProVoice || chordProVoice.voice.kind !== 'chordpro') return new Set<string>();
    const sections = buildRenderModel(parseChordPro(chordProVoice.voice.body)).sections;
    return new Set(matchAnchorsToChordProSections(anchors, sections).keys());
  }, [doc, songId, anchors]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (anchors.length === 0 && !canEdit) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = anchors.map((a) => a.id);
    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, String(active.id));
    reorderAnchors(doc, songId, reordered);
  }

  function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    createAnchor(doc, songId, { label });
    setNewLabel('');
  }

  return (
    <div className="rounded-md border border-border p-4">
      <p className="mb-2 text-sm font-medium">{t('songAnchors.title')}</p>
      {anchors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('songAnchors.empty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={anchors.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {anchors.map((anchor) => (
                <SortableAnchorRow
                  key={anchor.id}
                  anchor={anchor}
                  matchesChordProSection={matchedSectionIds.has(anchor.id)}
                  canEdit={canEdit}
                  onEdit={(patch) => updateAnchor(doc, songId, anchor.id, patch)}
                  onDelete={() => deleteAnchor(doc, songId, anchor.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('songAnchors.newPlaceholder')}
            className="h-8 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            {t('songAnchors.add')}
          </Button>
        </div>
      )}
    </div>
  );
}
