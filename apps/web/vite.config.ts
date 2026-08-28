// SPDX-License-Identifier: Apache-2.0
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // `injectManifest` (a real src/sw.ts we own) rather than `generateSW`
      // (a fully auto-generated one) — needed so push/notificationclick
      // listeners can be added to the service worker (see src/sw.ts).
      // Band data offline support is already handled by y-indexeddb; this
      // service worker's job is narrowly the app shell + static assets so
      // the app still loads (and shows already-synced bands) with no network.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      manifest: {
        name: 'Bandstand',
        short_name: 'Bandstand',
        description: 'Offline-first workspace for bands: repertoire, setlists, and Stage Mode.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // The whole monorepo shares one .env at the repo root (see .env.example)
  // instead of each app needing its own copy — Vite's default envDir is
  // this app's own directory, so it has to be pointed at the root explicitly.
  envDir: '../../',
  server: {
    port: 5173,
  },
});
