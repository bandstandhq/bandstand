// SPDX-License-Identifier: Apache-2.0
//
// The current user's own band list — fetched data, not a device
// preference (contrast stores/activeBand.ts/sidebarPrefs.ts, both
// `persist`ed), so this deliberately does *not* survive a reload: only a
// cache for the lifetime of one signed-in session, letting every mounted
// BandSwitcher instance read the same list instantly on remount instead of
// re-fetching and flashing empty each time (every page navigation remounts
// PageShell/AppSidebar — see BandSwitcher.tsx's own comment). Must be
// cleared on sign-out (see useAppNavLinks.ts's signOutAndReset) or the next
// person signing in on this device would briefly see the previous user's
// band names before the first fetch overwrites it.
import { create } from 'zustand';
import type { MyBand } from '@bandstand/api-client';

interface MyBandsState {
  bands: MyBand[] | null;
  setBands: (bands: MyBand[]) => void;
  upsertBand: (band: MyBand) => void;
  reset: () => void;
}

export const useMyBandsStore = create<MyBandsState>()((set) => ({
  bands: null,
  setBands: (bands) => set({ bands }),
  upsertBand: (band) =>
    set((state) => ({
      bands: [...(state.bands ?? []).filter((b) => b.id !== band.id), band],
    })),
  reset: () => set({ bands: null }),
}));
