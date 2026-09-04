// SPDX-License-Identifier: Apache-2.0
//
// Whether the desktop sidebar is collapsed — a local layout preference, not
// a `user_prefs` field (see stores/userPrefs.ts): it's per-device, not
// something worth a server round-trip or syncing across a user's devices.
// Persisted the same way as stores/activeBand.ts.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarPrefsState {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarPrefsStore = create<SidebarPrefsState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    { name: 'bandstand-sidebar-prefs' },
  ),
);
