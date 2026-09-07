// SPDX-License-Identifier: Apache-2.0
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { registerSW } from 'virtual:pwa-register';
import './i18n';
import './index.css';
import { initializeServerConfig } from './lib/serverConfig';

// Manual registration, not vite-plugin-pwa's auto HTML-injection (see vite.config.ts's
// injectRegister: false comment for why that doesn't fire here).
registerSW({ immediate: true });

// Must resolve before anything reads DEFAULT_SERVER_CONFIG — lib/auth-client.ts and
// lib/api-client.ts each build a module-level client singleton from it at import time (this exact
// bug shipped once: signup/login silently pointed at the dev fallback in production). Route
// modules are code-split and only imported once HydratedRouter starts matching, which happens
// after this await — verified against a real production build, not just assumed from RR's docs.
await initializeServerConfig();

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
);
