// SPDX-License-Identifier: Apache-2.0
//
// Content-addressed blobs are cached via the Cache API, deliberately
// separate from the app-shell service worker's precache (vite.config.ts) —
// that one is Workbox-managed static assets; this one is dynamic, per-band
// file content. Since a hash never changes what it points to, a cached
// blob never needs revalidating — see docs/adr/0007-content-addressed-files.md.
const CACHE_NAME = 'bandstand-blobs';

function cacheKey(sha256: string): string {
  return `/blobs/${sha256}`;
}

export async function isBlobCached(sha256: string): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(cacheKey(sha256))) !== undefined;
}

/** Returns the cached blob, or undefined if it isn't cached yet — never fetches. */
export async function getCachedBlob(sha256: string): Promise<Blob | undefined> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(cacheKey(sha256));
  return response?.blob();
}

/** Fetches and caches a blob if it isn't already cached; a no-op cache hit otherwise. */
export async function ensureCached(sha256: string, getDownloadUrl: () => Promise<string>): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(cacheKey(sha256))) return;

  const url = await getDownloadUrl();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch blob ${sha256}: ${response.status}`);
  await cache.put(cacheKey(sha256), response);
}
