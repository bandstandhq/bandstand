// SPDX-License-Identifier: Apache-2.0
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { BandSettings } from './pages/BandSettings';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/bands/:bandId/settings" element={<BandSettings />} />
      </Routes>
    </BrowserRouter>
  );
}
