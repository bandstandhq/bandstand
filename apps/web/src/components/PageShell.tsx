// SPDX-License-Identifier: Apache-2.0
//
// Just the per-page title + content wrapper now — the wide/narrow chrome fork
// (AppSidebar vs BottomNav) moved up to AuthenticatedLayout.tsx so it renders
// once for the whole authenticated area instead of once per page, which
// matters now that multiple pages can be simultaneously resident (see
// PersistentRouteHost.tsx) rather than always fully unmounted on navigation.
import type { ReactNode } from 'react';

export function PageShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <h1 className="mb-4 text-xl font-medium">{title}</h1>
      {children}
    </>
  );
}
