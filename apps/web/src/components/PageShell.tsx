// SPDX-License-Identifier: Apache-2.0
//
// The shared chrome for every signed-in page except Stage Mode (which
// deliberately has none at all — see StageMode.tsx) and the pre-auth pages
// (Login/Signup/...). Centralizing this is what keeps every page's outer
// spacing identical without each one having to remember the exact classes —
// AccountSettings drifting to its own narrower padding (issue: inconsistent
// page margins) is exactly the kind of divergence this prevents.
//
// Owns the wide/narrow fork itself (AppSidebar used to do this internally,
// back when it was AppHeader and rendered inline instead of as a layout
// sibling to <main>) — a persistent sidebar has to sit *next to* <main>,
// not inside it, so something above both needs to decide which one shows.
// 640px (Tailwind `sm`) is this fork's own line, matching every other
// narrow-screen check in this app (Calendar/BandSettings/Repertoire's own
// table-vs-card layouts). It's a *different* number from
// useIsWideScreen.ts's 1024px (`lg`), which SetlistList uses to decide
// whether board view is even offered — that's an intentionally separate
// concern (content density, not nav chrome), not drift: from 640–1024px the
// sidebar takes real width (256px expanded), so forcing list view in that
// band is if anything more correct with a sidebar present than without one.
import type { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { MobileNav } from './MobileNav';
import { useMediaQuery } from '../hooks/useMediaQuery';

export function PageShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const isWide = useMediaQuery('(min-width: 640px)');

  if (isWide) {
    return (
      <div className="flex min-h-screen bg-background text-foreground">
        <AppSidebar />
        <main className="min-w-0 flex-1 p-6">
          <h1 className="mb-4 text-xl font-medium">{title}</h1>
          {children}
        </main>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <MobileNav title={title} />
      {children}
    </main>
  );
}
