// SPDX-License-Identifier: Apache-2.0
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The whole monorepo shares one .env at the repo root (see .env.example)
  // instead of each app needing its own copy — Vite's default envDir is
  // this app's own directory, so it has to be pointed at the root explicitly.
  envDir: '../../',
  server: {
    port: 5173,
  },
});
