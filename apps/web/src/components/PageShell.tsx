// SPDX-License-Identifier: Apache-2.0
//
// The shared chrome for every signed-in page except Stage Mode (which
// deliberately has none at all — see StageMode.tsx, and it's never wrapped
// in PageShell to begin with) and the pre-auth pages (Login/Signup/...).
// Centralizing this is what keeps every page's outer spacing identical
// without each one having to remember the exact classes.
//
// Owns the wide/narrow fork itself: wide gets a topbar above <main>; narrow
// gets a fixed bottom tab bar below it, so <main> needs bottom padding
// (pb-20) to clear it — BottomNav is h-16 plus its own safe-area padding,
// and 20 (5rem/80px) leaves a comfortable margin above that. 640px
// (Tailwind `sm`) is this fork's own line, matching every other
// narrow-screen check in this app (Calendar/BandSettings/Repertoire's own
// table-vs-card layouts). It's a *different* number from
// useIsWideScreen.ts's 1024px (`lg`), which SetlistList uses to decide
// whether board view is even offered — that's an intentionally separate
// concern (content density, not nav chrome), not drift.
import type { ReactNode } from 'react';
import { AppTopbar } from './AppTopbar';
import { BottomNav } from './BottomNav';
import { useMediaQuery } from '../hooks/useMediaQuery';

export function PageShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const isWide = useMediaQuery('(min-width: 640px)');

  if (isWide) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppTopbar title={title} />
        <main className="p-6">{children}</main>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background p-6 pb-20 text-foreground">
      <h1 className="mb-4 text-xl font-medium">{title}</h1>
      {children}
      <BottomNav />
    </main>
  );
}
