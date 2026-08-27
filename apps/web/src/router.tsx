// SPDX-License-Identifier: Apache-2.0
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { BandSettings } from './pages/BandSettings';
import { Calendar } from './pages/Calendar';
import { Dashboard } from './pages/Dashboard';
import { EventDetail } from './pages/EventDetail';
import { PollDetail } from './pages/PollDetail';
import { JoinBand } from './pages/JoinBand';
import { Login } from './pages/Login';
import { Repertoire } from './pages/Repertoire';
import { SetlistDetail } from './pages/SetlistDetail';
import { SetlistList } from './pages/SetlistList';
import { Signup } from './pages/Signup';
import { SongEditor } from './pages/SongEditor';
import { StageMode } from './pages/StageMode';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/settings"
          element={
            <RequireAuth>
              <BandSettings />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/repertoire"
          element={
            <RequireAuth>
              <Repertoire />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/songs/new"
          element={
            <RequireAuth>
              <SongEditor />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/songs/:songId/edit"
          element={
            <RequireAuth>
              <SongEditor />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/setlists"
          element={
            <RequireAuth>
              <SetlistList />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/setlists/:setlistId"
          element={
            <RequireAuth>
              <SetlistDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/setlists/:setlistId/stage/:itemId"
          element={
            <RequireAuth>
              <StageMode />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/calendar"
          element={
            <RequireAuth>
              <Calendar />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/calendar/:occurrenceId"
          element={
            <RequireAuth>
              <EventDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/bands/:bandId/polls/:pollId"
          element={
            <RequireAuth>
              <PollDetail />
            </RequireAuth>
          }
        />
        <Route path="/join/:code" element={<JoinBand />} />
      </Routes>
    </BrowserRouter>
  );
}
