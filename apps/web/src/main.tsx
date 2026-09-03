// SPDX-License-Identifier: Apache-2.0
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { initializeServerConfig } from './lib/serverConfig';

// Must resolve before anything reads DEFAULT_SERVER_CONFIG — and, critically, before the router
// module tree is even *evaluated*, not just before it renders. lib/auth-client.ts and
// lib/api-client.ts each build a module-level client singleton as `createXClient(getActiveServerConfig().serverUrl)`
// at import time; a static `import { AppRouter } from './router'` up here would pull those modules
// in and freeze that stale, pre-fetch value into every auth/API call for the rest of the session
// (this exact bug shipped once — signup/login silently pointed at the dev fallback in production).
// A dynamic import() defers evaluating './router' and everything it transitively imports until
// this line actually runs, i.e. strictly after the fetch below has already updated
// DEFAULT_SERVER_CONFIG. A no-op in dev and in a wrapped Capacitor/Tauri app, and a same-origin
// fetch (well under 100ms) otherwise — see index.html for the loading state shown during that gap.
await initializeServerConfig();
const { AppRouter } = await import('./router');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
