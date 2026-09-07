// SPDX-License-Identifier: Apache-2.0
import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';
import { bandRouteShapes } from './routes/bandRouteConfig';

// The band-scoped route paths are generated from bandRouteConfig.ts's pure shape
// data (also consumed at runtime by useAppNavLinks.ts's band-switch logic) —
// kept as the single source of truth rather than duplicating each path here.
//
// Stage Mode's two routes are the only band routes NOT rendered through
// AuthenticatedLayout/PersistentRouteHost below — it has no nav chrome (see
// AuthenticatedLayout.tsx) and, being a full-screen performance view rather
// than something you bounce between other pages and back, doesn't benefit
// from staying resident the way Dashboard/Repertoire/etc. do. It still needs
// routes/bandPages/stageMode.tsx's KeyedByBandId wrapper, since outside the
// persistence mechanism the original same-component-instance-across-bands
// problem still applies. Every other path here maps straight to its page
// component's own default export (no wrapper needed) — PersistentRouteHost
// makes per-band remounting fall out of pathname-based slot keys instead.
export const bandRoutePathToFile: Record<string, string> = {
  dashboard: 'pages/Dashboard.tsx',
  settings: 'pages/BandSettings.tsx',
  repertoire: 'pages/Repertoire.tsx',
  'songs/new': 'pages/SongEditor.tsx',
  'songs/:songId/edit': 'pages/SongEditor.tsx',
  'songs/:songId/play': 'routes/bandPages/stageMode.tsx',
  setlists: 'pages/SetlistList.tsx',
  'setlists/:setlistId': 'pages/SetlistDetail.tsx',
  'setlists/:setlistId/stage/:itemId': 'routes/bandPages/stageMode.tsx',
  calendar: 'pages/Calendar.tsx',
  'calendar/:occurrenceId': 'pages/EventDetail.tsx',
  'polls/:pollId': 'pages/PollDetail.tsx',
};

const STAGE_MODE_PATHS = new Set(['songs/:songId/play', 'setlists/:setlistId/stage/:itemId']);

function bandRoute(shapePath: string) {
  const file = bandRoutePathToFile[shapePath];
  if (!file) throw new Error(`No component registered for band route "${shapePath}"`);
  // Explicit id: songs/new + songs/:songId/edit share a file, as do the two
  // Stage Mode paths — the id RR would otherwise derive from the file path collides.
  return route(`bands/:bandId/${shapePath}`, file, { id: `band-route:${shapePath}` });
}

export default [
  layout('components/RootLayout.tsx', [
    index('pages/RootRedirect.tsx'),
    route('login', 'pages/Login.tsx'),
    route('signup', 'pages/Signup.tsx'),
    route('forgot-password', 'pages/ForgotPassword.tsx'),
    route('reset-password', 'pages/ResetPassword.tsx'),
    route('account/confirm-email-change', 'pages/ConfirmEmailChange.tsx'),
    route('account/cancel-email-change', 'pages/CancelEmailChange.tsx'),
    layout('components/RequireAuthLayout.tsx', [
      layout('components/AuthenticatedLayout.tsx', [
        route('settings', 'pages/AccountSettings.tsx'),
        route('dashboard', 'pages/DashboardRedirect.tsx'),
        ...bandRouteShapes.filter((shape) => !STAGE_MODE_PATHS.has(shape.path)).map((shape) => bandRoute(shape.path)),
      ]),
      ...bandRouteShapes.filter((shape) => STAGE_MODE_PATHS.has(shape.path)).map((shape) => bandRoute(shape.path)),
    ]),
    route('join/:code', 'pages/JoinBand.tsx'),
  ]),
] satisfies RouteConfig;
