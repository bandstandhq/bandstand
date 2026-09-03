// SPDX-License-Identifier: Apache-2.0
//
// The sync path described in docs/ARCHITECTURE.md: a Y.Doc backed by
// IndexedDB locally (works offline once loaded) and synced to the server
// over Hocuspocus when a connection is available. See hooks/useBandDoc.ts
// for the React-facing wrapper feature pages actually use.
import { HocuspocusProvider } from '@hocuspocus/provider';
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { getActiveServerConfig } from './serverConfig';

export interface BandDocConnection {
  doc: Y.Doc;
  indexeddb: IndexeddbPersistence;
  provider: HocuspocusProvider;
}

// Scoped by user, not just band — see docs/adr/0006-offline-cache-scoping.md.
// A device shared (or previously used) by someone else must never surface
// this user's cached band content, and vice versa. Logging out deliberately
// leaves this data in place (same user, offline continuation); only an
// explicit "delete local data" action or a server-confirmed non-membership
// clears it.
export function bandIndexedDbName(userId: string, bandId: string): string {
  return `bandstand:${userId}:${bandId}`;
}

/**
 * The explicit "Delete local data" action (Dashboard) — logging out on its
 * own deliberately leaves these caches in place, see
 * docs/adr/0006-offline-cache-scoping.md. Silently does nothing where
 * `indexedDB.databases()` isn't available (notably older Safari): there's
 * no way to enumerate database names without it.
 */
export async function deleteAllLocalBandData(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  const prefix = `bandstand:${userId}:`;
  const databases = await indexedDB.databases();
  await Promise.all(
    databases
      .filter((entry): entry is { name: string } => !!entry.name?.startsWith(prefix))
      .map((entry) => clearDocument(entry.name)),
  );
}

export function connectBandDoc(userId: string, bandId: string, token: string): BandDocConnection {
  const doc = new Y.Doc();
  const indexeddb = new IndexeddbPersistence(bandIndexedDbName(userId, bandId), doc);
  const provider = new HocuspocusProvider({
    url: getActiveServerConfig().hocuspocusUrl,
    name: bandId,
    document: doc,
    token,
  });

  return { doc, indexeddb, provider };
}

interface RegistryEntry {
  connection: BandDocConnection;
  token: string;
  refCount: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

// Kept resident across page navigation (not just across re-renders of one
// page): a page revisited within IDLE_DESTROY_DELAY_MS of leaving it reuses
// the exact same Y.Doc/IndexeddbPersistence/HocuspocusProvider instead of
// tearing the connection down and reopening it — a real membership-check
// round-trip plus a full IndexedDB rehydrate and Hocuspocus resync. See
// issue #220.
const registry = new Map<string, RegistryEntry>();
const IDLE_DESTROY_DELAY_MS = 30_000;

function registryKey(userId: string, bandId: string): string {
  return `${userId}:${bandId}`;
}

function destroyEntry(entry: RegistryEntry): void {
  entry.connection.provider.destroy();
  entry.connection.indexeddb.destroy();
}

/** Reuses a still-resident connection for this user+band when one exists;
 * otherwise opens a fresh one. Pair every call with `releaseBandDoc`. */
export function acquireBandDoc(userId: string, bandId: string, token: string): BandDocConnection {
  const key = registryKey(userId, bandId);
  const existing = registry.get(key);
  if (existing && existing.token === token) {
    if (existing.destroyTimer !== null) {
      clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    existing.refCount += 1;
    return existing.connection;
  }
  if (existing) {
    // Stale token (a reconnect after the session was refreshed) — the old
    // connection is presumably unauthenticated already, so replace it
    // outright rather than trying to reuse it.
    if (existing.destroyTimer !== null) clearTimeout(existing.destroyTimer);
    destroyEntry(existing);
    registry.delete(key);
  }
  const connection = connectBandDoc(userId, bandId, token);
  registry.set(key, { connection, token, refCount: 1, destroyTimer: null });
  return connection;
}

/** Marks one caller as done with a connection acquired via `acquireBandDoc`.
 * The underlying connection is only torn down once no caller has re-acquired
 * it within `IDLE_DESTROY_DELAY_MS` — a quick navigate-away-and-back keeps it
 * alive instead of reconnecting from scratch. */
export function releaseBandDoc(userId: string, bandId: string): void {
  const key = registryKey(userId, bandId);
  const entry = registry.get(key);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;
  entry.destroyTimer = setTimeout(() => {
    registry.delete(key);
    destroyEntry(entry);
  }, IDLE_DESTROY_DELAY_MS);
}

/** Forcibly tears a connection down right away regardless of how many
 * callers still hold it — used when membership is denied, where staying
 * resident would just keep serving cached content to a non-member. */
export function evictBandDoc(userId: string, bandId: string): void {
  const key = registryKey(userId, bandId);
  const entry = registry.get(key);
  if (!entry) return;
  if (entry.destroyTimer !== null) clearTimeout(entry.destroyTimer);
  registry.delete(key);
  destroyEntry(entry);
}
