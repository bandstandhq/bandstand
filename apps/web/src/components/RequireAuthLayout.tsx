// SPDX-License-Identifier: Apache-2.0
import { Outlet } from 'react-router';
import { RequireAuth } from './RequireAuth';

export default function RequireAuthLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}
