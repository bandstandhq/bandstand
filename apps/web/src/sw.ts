// SPDX-License-Identifier: Apache-2.0
//
// `injectManifest` strategy (see vite.config.ts) — a real source file
// instead of vite-plugin-pwa's auto-generated `generateSW` service worker,
// switched to specifically so push/notificationclick listeners can be
// added below. `self.__WB_MANIFEST` is replaced at build time with the
// same precache list `generateSW` computed automatically; everything
// below that line is this file's own addition, not Workbox's.
//
// Band data offline support is unrelated to this file — that's
// y-indexeddb (the Yjs doc) plus `../lib/blobCache.ts`'s own direct Cache
// API usage for song attachments, neither of which goes through this
// service worker's fetch handling at all. This SW's job stays narrowly
// the app shell + static assets, same as before the strategy switch.
/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// A minimal structural check, not `@bandstand/core`'s full pushPayloadSchema
// (zod) — importing that package's barrel here would pull the whole thing
// (including Yjs) into this service worker bundle, several times its
// current size, for one small shape check. The server (push/send.ts) still
// validates the outgoing payload against the real schema before sending;
// this only guards against a malformed/unexpected event.data on the way in.
interface PushPayload {
  title: string;
  body: string;
  url: string;
}

function parsePushPayload(data: unknown): PushPayload {
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as Record<string, unknown>).title === 'string' &&
    typeof (data as Record<string, unknown>).body === 'string' &&
    typeof (data as Record<string, unknown>).url === 'string'
  ) {
    return data as PushPayload;
  }
  return { title: 'Bandstand', body: 'You have a new notification.', url: '/dashboard' };
}

// Matches `generateSW`'s `registerType: 'autoUpdate'` behavior: a new SW
// version activates immediately rather than waiting for every open tab to
// close first.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// `precacheAndRoute` alone only serves requests that exactly match a
// precached URL (i.e. literally `/index.html`) — an SPA route like
// `/dashboard` needs this explicit navigation fallback to resolve to the
// same cached shell, exactly like `generateSW` mode registers automatically.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// A push message's payload is JSON matching `PushPayload` (see
// push/send.ts on the server) — an invalid/missing/non-JSON payload shows a
// generic notification rather than silently doing nothing, since a push
// event with no visible result on some platforms gets the origin's push
// permission revoked for "showing no notification."
self.addEventListener('push', (event) => {
  let json: unknown;
  try {
    json = event.data?.json();
  } catch {
    json = undefined;
  }
  const payload = parsePushPayload(json);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

// Focuses an already-open Bandstand tab and navigates it to the
// notification's deep link, rather than always opening a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/dashboard', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => 'focus' in c && 'navigate' in c) as WindowClient | undefined;
      if (existing) {
        await existing.navigate(url);
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
