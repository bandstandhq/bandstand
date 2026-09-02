// SPDX-License-Identifier: Apache-2.0
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { AppRouter } from './router';
import { initializeServerConfig } from './lib/serverConfig';

// Must resolve before the app tree renders — every downstream reader of
// DEFAULT_SERVER_CONFIG (ServerPicker.tsx, the API/Yjs client setup) reads
// it synchronously, on the assumption that by the time anything actually
// renders, GET /config.json (see serverConfig.ts) has already had its
// chance to replace the build-time fallback. A no-op in dev and in a
// wrapped Capacitor/Tauri app, and a same-origin fetch (well under 100ms)
// otherwise — see index.html for the loading state shown during that gap.
await initializeServerConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
