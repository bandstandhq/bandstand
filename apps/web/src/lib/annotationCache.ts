// SPDX-License-Identifier: Apache-2.0
//
// Local cache + offline queue for personal voice annotations — IndexedDB,
// not the Cache API blob store from A4 (this is structured data, not blob
// bytes) and not Yjs (annotations are REST, never CRDT — see B4 of the
// Milestone 2 Teil B plan and docs/adr/0010-anchor-sync.md). Write-through
// on every local edit; a pending edit not yet confirmed by the server
// survives a reload and is retried once back online.
import type { AnnotationLayerDto, ApiClient } from '@bandstand/api-client';
import type { AnnotationObject } from '@bandstand/core';

const DB_NAME = 'bandstand-annotations';
const STORE_NAME = 'layers';
const DB_VERSION = 1;

export interface CachedLayer {
  bandId: string;
  layer: AnnotationLayerDto;
  /** A local edit not yet confirmed by the server — replayed by flushPendingEdits. */
  pending?: { objects: AnnotationObject[]; baseUpdatedAt: string };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'layer.id' });
        store.createIndex('by_voice', 'layer.voiceId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedLayers(voiceId: string): Promise<CachedLayer[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  return promisify(tx.objectStore(STORE_NAME).index('by_voice').getAll(voiceId));
}

async function putCachedLayer(record: CachedLayer): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await promisify(tx.objectStore(STORE_NAME).put(record));
}

export async function deleteCachedLayer(layerId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await promisify(tx.objectStore(STORE_NAME).delete(layerId));
}

/**
 * Refreshes the cache from the server when reachable; falls back to
 * whatever's cached when it isn't (offline is a normal state here, not an
 * error). A layer with an unconfirmed local edit (`pending`) keeps that
 * edit even though the freshly-fetched server copy doesn't reflect it yet
 * — `flushPendingEdits` is what reconciles that, not a read.
 */
export async function syncLayersForVoice(apiClient: ApiClient, bandId: string, voiceId: string): Promise<CachedLayer[]> {
  const cached = await getCachedLayers(voiceId);

  let serverLayers: AnnotationLayerDto[];
  try {
    serverLayers = await apiClient.listMyAnnotationLayers(bandId, voiceId);
  } catch {
    return cached;
  }

  const cachedById = new Map(cached.map((record) => [record.layer.id, record]));
  const merged: CachedLayer[] = serverLayers.map((serverLayer) => {
    const existing = cachedById.get(serverLayer.id);
    return existing?.pending ? { ...existing, layer: serverLayer } : { bandId, layer: serverLayer };
  });

  for (const record of merged) await putCachedLayer(record);
  return merged;
}

/** Write-through: a local edit updates the cache immediately and is queued for the server. */
export async function recordLocalEdit(
  bandId: string,
  currentLayer: AnnotationLayerDto,
  objects: AnnotationObject[],
  baseUpdatedAt: string,
): Promise<void> {
  await putCachedLayer({
    bandId,
    layer: { ...currentLayer, objects },
    pending: { objects, baseUpdatedAt },
  });
}

/**
 * Sends every layer's queued edit, if any. A conflict (see
 * routes/annotations.ts's conditional update) means the server forked a
 * "(Conflict Copy)" layer instead of applying this edit — the fork is
 * cached directly (already confirmed, no `pending`), and a full re-sync
 * pulls in the original layer's now-diverged server state too, so nothing
 * is left looking newer locally than it actually is. Still offline or
 * unreachable: `pending` is simply left in place for the next attempt —
 * never an error surfaced to the caller.
 */
export async function flushPendingEdits(apiClient: ApiClient, bandId: string, voiceId: string): Promise<void> {
  const cached = await getCachedLayers(voiceId);
  let hadConflict = false;

  for (const record of cached) {
    if (!record.pending) continue;
    try {
      const { conflict, layer } = await apiClient.updateAnnotationLayer(bandId, record.layer.id, {
        objects: record.pending.objects,
        expectedUpdatedAt: record.pending.baseUpdatedAt,
      });
      if (conflict) hadConflict = true;
      await putCachedLayer({ bandId, layer });
    } catch {
      // Offline or unreachable — leave `pending` in place, retried next time.
    }
  }

  if (hadConflict) await syncLayersForVoice(apiClient, bandId, voiceId);
}
