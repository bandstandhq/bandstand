// SPDX-License-Identifier: Apache-2.0
//
// Pure Y.Doc mutations/reads for a song's `anchors:<songId>` Y.Array — same
// shape as `items:<setlistId>` (packages/core/src/yjs/setlists.ts), just
// keyed by song instead of setlist. See docs/adr/0010-anchor-sync.md.
import * as Y from 'yjs';
import { type Anchor, anchorSchema } from '../schemas/anchor';
import { anchorsKey } from './snapshot';

/** Every anchor for a song, sorted by `order` — Y.Array insertion order isn't guaranteed to match it after edits. */
export function listAnchorsForSong(doc: Y.Doc, songId: string): Anchor[] {
  return (doc.getArray(anchorsKey(songId)).toJSON() as Anchor[]).sort((a, b) => a.order - b.order);
}

export function createAnchor(doc: Y.Doc, songId: string, input: { label: string; bar?: number; timeMs?: number }): string {
  const id = crypto.randomUUID();
  const existing = listAnchorsForSong(doc, songId);
  const order = existing.length > 0 ? Math.max(...existing.map((a) => a.order)) + 1 : 0;
  const anchor = anchorSchema.parse({ id, order, ...input });
  doc.getArray(anchorsKey(songId)).push([anchor]);
  return id;
}

function findAnchorIndex(doc: Y.Doc, songId: string, anchorId: string): number {
  return doc
    .getArray(anchorsKey(songId))
    .toArray()
    .findIndex((a) => (a as Anchor).id === anchorId);
}

export function updateAnchor(
  doc: Y.Doc,
  songId: string,
  anchorId: string,
  patch: Partial<Pick<Anchor, 'label' | 'bar' | 'timeMs'>>,
): void {
  const array = doc.getArray(anchorsKey(songId));
  const index = findAnchorIndex(doc, songId, anchorId);
  if (index === -1) throw new Error(`Anchor not found: ${anchorId}`);

  const existing = array.get(index) as Anchor;
  const updated = anchorSchema.parse({ ...existing, ...patch });
  doc.transact(() => {
    array.delete(index, 1);
    array.insert(index, [updated]);
  });
}

export function deleteAnchor(doc: Y.Doc, songId: string, anchorId: string): void {
  const index = findAnchorIndex(doc, songId, anchorId);
  if (index === -1) return;
  doc.getArray(anchorsKey(songId)).delete(index, 1);
}

/**
 * Replaces every anchor's `order` to match `orderedIds` — the whole-array
 * rewrite `moveSetlistItem` uses for the same reason: there's no native
 * Y.Array "move" op, and a concurrent reorder from another client still
 * merges without losing anchors, just without a guaranteed final order under
 * a true concurrent conflict.
 */
export function reorderAnchors(doc: Y.Doc, songId: string, orderedIds: string[]): void {
  const array = doc.getArray(anchorsKey(songId));
  const existing = array.toJSON() as Anchor[];
  const byId = new Map(existing.map((a) => [a.id, a]));

  const reordered = orderedIds
    .map((id, order) => {
      const anchor = byId.get(id);
      return anchor ? anchorSchema.parse({ ...anchor, order }) : undefined;
    })
    .filter((a): a is Anchor => a !== undefined);

  doc.transact(() => {
    if (array.length > 0) array.delete(0, array.length);
    array.push(reordered);
  });
}
