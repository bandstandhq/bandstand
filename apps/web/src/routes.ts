// SPDX-License-Identifier: Apache-2.0
import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';
import { bandRouteShapes } from './routes/bandRouteConfig';

// The band-scoped route paths are generated from bandRouteConfig.ts's pure shape
// data (also consumed at runtime by useAppNavLinks.ts's band-switch logic) —
// kept as the single source of truth rather than duplicating each path here. Each
// file wraps its page component with KeyedByBandId (see routes/bandPages/*.tsx) —
// RequireAuth itself is applied once, above, by the shared RequireAuthLayout.
export const bandRoutePathToFile: Record<string, string> = {
  dashboard: 'routes/bandPages/dashboard.tsx',
  settings: 'routes/bandPages/bandSettings.tsx',
  repertoire: 'routes/bandPages/repertoire.tsx',
  'songs/new': 'routes/bandPages/songEditor.tsx',
  'songs/:songId/edit': 'routes/bandPages/songEditor.tsx',
  'songs/:songId/play': 'routes/bandPages/stageMode.tsx',
  setlists: 'routes/bandPages/setlistList.tsx',
  'setlists/:setlistId': 'routes/bandPages/setlistDetail.tsx',
  'setlists/:setlistId/stage/:itemId': 'routes/bandPages/stageMode.tsx',
  calendar: 'routes/bandPages/calendar.tsx',
  'calendar/:occurrenceId': 'routes/bandPages/eventDetail.tsx',
  'polls/:pollId': 'routes/bandPages/pollDetail.tsx',
};

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
      route('settings', 'pages/AccountSettings.tsx'),
      route('dashboard', 'pages/DashboardRedirect.tsx'),
      ...bandRouteShapes.map((shape) => {
        const file = bandRoutePathToFile[shape.path];
        if (!file) throw new Error(`No component registered for band route "${shape.path}"`);
        // Explicit id: two paths (songs/new + songs/:songId/edit; songs/:songId/play +
        // setlists/:setlistId/stage/:itemId) reuse the same file, so the id RR would
        // otherwise derive from the file path collides.
        return route(`bands/:bandId/${shape.path}`, file, { id: `band-route:${shape.path}` });
      }),
    ]),
    route('join/:code', 'pages/JoinBand.tsx'),
  ]),
] satisfies RouteConfig;
