// SPDX-License-Identifier: Apache-2.0
//
// The wide/narrow chrome fork PageShell used to own, hoisted up here so it
// renders exactly once for the whole authenticated area — not once per page,
// which would mean N duplicate AppSidebar/BottomNav instances once multiple
// pages can be simultaneously resident (see PersistentRouteHost). Stage Mode
// routes deliberately sit outside this layout (see routes.ts) since they
// have no chrome at all, same as before this restructuring.
import { AppSidebar } from './AppSidebar';
import { BottomNav } from './BottomNav';
import { PersistentRouteHost } from './PersistentRouteHost';
import { useMediaQuery } from '../hooks/useMediaQuery';

export default function AuthenticatedLayout() {
  const isWide = useMediaQuery('(min-width: 640px)');

  if (isWide) {
    return (
      <div className="flex min-h-dvh bg-background text-foreground">
        <AppSidebar />
        <main className="min-w-0 flex-1 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <PersistentRouteHost />
        </main>
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-background p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] text-foreground">
      <PersistentRouteHost />
      <BottomNav />
    </main>
  );
}
