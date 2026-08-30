// SPDX-License-Identifier: Apache-2.0
//
// The shared chrome for every signed-in page except Stage Mode (which
// deliberately has none at all — see StageMode.tsx) and the pre-auth pages
// (Login/Signup/...). Centralizing this is what keeps every page's outer
// spacing identical without each one having to remember the exact classes —
// AccountSettings drifting to its own narrower padding (issue: inconsistent
// page margins) is exactly the kind of divergence this prevents.
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';

export function PageShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <AppHeader title={title} />
      {children}
    </main>
  );
}
