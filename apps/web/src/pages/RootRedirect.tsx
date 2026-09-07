// SPDX-License-Identifier: Apache-2.0
import { Navigate } from 'react-router';

export default function RootRedirect() {
  return <Navigate to="/dashboard" replace />;
}
