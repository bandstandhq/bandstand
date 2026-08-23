// SPDX-License-Identifier: Apache-2.0
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { BandSettings } from './pages/BandSettings';
import { Dashboard } from './pages/Dashboard';
import { JoinBand } from './pages/JoinBand';
import { Login } from './pages/Login';
import { Repertoire } from './pages/Repertoire';
import { Signup } from './pages/Signup';
import { SongEditor } from './pages/SongEditor';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/bands/:bandId/settings" element={<BandSettings />} />
        <Route path="/bands/:bandId/repertoire" element={<Repertoire />} />
        <Route path="/bands/:bandId/songs/new" element={<SongEditor />} />
        <Route path="/bands/:bandId/songs/:songId/edit" element={<SongEditor />} />
        <Route path="/join/:code" element={<JoinBand />} />
      </Routes>
    </BrowserRouter>
  );
}
