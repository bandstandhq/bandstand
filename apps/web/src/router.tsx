// SPDX-License-Identifier: Apache-2.0
import type { ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { GlobalPrefsEffects } from './components/GlobalPrefsEffects';
import { RequireAuth } from './components/RequireAuth';
import { AccountSettings } from './pages/AccountSettings';
import { BandSettings } from './pages/BandSettings';
import { Calendar } from './pages/Calendar';
import { CancelEmailChange } from './pages/CancelEmailChange';
import { ConfirmEmailChange } from './pages/ConfirmEmailChange';
import { Dashboard } from './pages/Dashboard';
import { DashboardRedirect } from './pages/DashboardRedirect';
import { EventDetail } from './pages/EventDetail';
import { ForgotPassword } from './pages/ForgotPassword';
import { JoinBand } from './pages/JoinBand';
import { Login } from './pages/Login';
import { PollDetail } from './pages/PollDetail';
import { Repertoire } from './pages/Repertoire';
import { ResetPassword } from './pages/ResetPassword';
import { SetlistDetail } from './pages/SetlistDetail';
import { SetlistList } from './pages/SetlistList';
import { Signup } from './pages/Signup';
import { SongEditor } from './pages/SongEditor';
import { StageMode } from './pages/StageMode';
import { bandRouteShapes } from './routes/bandRouteConfig';

// Pairs each pure route shape (routes/bandRouteConfig.ts) with its page
// component — the one place that combination is made. bandRouteConfig.ts
// stays component-free so AppHeader's band-switch navigation can import
// just the shape data without pulling in every page (and cycling back
// through Dashboard -> AppHeader -> here).
export const bandRouteComponents: Record<string, ComponentType> = {
  dashboard: Dashboard,
  settings: BandSettings,
  repertoire: Repertoire,
  'songs/new': SongEditor,
  'songs/:songId/edit': SongEditor,
  'songs/:songId/play': StageMode,
  setlists: SetlistList,
  'setlists/:setlistId': SetlistDetail,
  'setlists/:setlistId/stage/:itemId': StageMode,
  calendar: Calendar,
  'calendar/:occurrenceId': EventDetail,
  'polls/:pollId': PollDetail,
};

/**
 * Remounts `Component` whenever the `:bandId` route param changes. React
 * Router doesn't remount a route's element just because a param changed —
 * without this, switching bands while on one of these routes would carry
 * over whatever local state the page had (search text, an open filter, a
 * selected-but-now-wrong-band song) instead of resetting it, because it's
 * still the same component instance. Putting `key` here once is what makes
 * that reset "fall out" of navigation for every page, instead of needing
 * its own teardown effect.
 */
function KeyedByBandId({ Component }: { Component: ComponentType }) {
  const { bandId } = useParams<{ bandId: string }>();
  return <Component key={bandId} />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <GlobalPrefsEffects />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/account/confirm-email-change" element={<ConfirmEmailChange />} />
        <Route path="/account/cancel-email-change" element={<CancelEmailChange />} />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <AccountSettings />
            </RequireAuth>
          }
        />
        {/* Resolves which band's dashboard to show (or the zero-bands empty
            state) fresh from the current session every time — see
            DashboardRedirect.tsx. Never renders band-scoped content itself;
            /bands/:bandId/dashboard below (part of bandRouteShapes, like
            every other band-scoped page) does that. */}
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardRedirect />
            </RequireAuth>
          }
        />
        {bandRouteShapes.map((route) => {
          const Component = bandRouteComponents[route.path];
          if (!Component) throw new Error(`No component registered for band route "${route.path}"`);
          return (
            <Route
              key={route.path}
              path={`/bands/:bandId/${route.path}`}
              element={
                <RequireAuth>
                  <KeyedByBandId Component={Component} />
                </RequireAuth>
              }
            />
          );
        })}
        <Route path="/join/:code" element={<JoinBand />} />
      </Routes>
    </BrowserRouter>
  );
}
