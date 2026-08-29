// SPDX-License-Identifier: Apache-2.0
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Needed in addition to envDir below: this populates `process.env` for
  // use inside this config file itself (Node context) — envDir only
  // controls which .env Vite exposes to client code as `import.meta.env`.
  const env = loadEnv(mode, '../../', '');

  return {
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
      // Off by default (Vite binds to localhost only), needed so the app is
      // reachable from another device on the LAN, e.g. a phone — see
      // CONTRIBUTING.md's "Testing on mobile devices" section. This only
      // affects `vite dev`/`vite preview`; it has no effect on `vite build`.
      host: true,
      // Vite's DNS-rebinding protection rejects any request whose Host
      // header it doesn't recognize; a LAN IP is allowed automatically, but
      // a tunnel hostname (e.g. cloudflared's `*.trycloudflare.com`, see
      // CONTRIBUTING.md's "Testing on mobile devices" section) isn't, and
      // has to be added explicitly — never as a blanket `true` here, only
      // via this per-machine, uncommitted env var.
      allowedHosts: env.VITE_DEV_ALLOWED_HOSTS
        ? env.VITE_DEV_ALLOWED_HOSTS.split(',')
            .map((host) => host.trim())
            .filter(Boolean)
        : undefined,
    },
  };
});
