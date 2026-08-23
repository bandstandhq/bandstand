// SPDX-License-Identifier: Apache-2.0
//
// Which band the user is currently viewing — UI state (Zustand), not
// shared/collaborative data (that's Yjs). Persisted to localStorage so the
// choice survives a reload, per-device as intended.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ActiveBandState {
  activeBandId: string | null;
  setActiveBandId: (bandId: string | null) => void;
}

export const useActiveBandStore = create<ActiveBandState>()(
  persist(
    (set) => ({
      activeBandId: null,
      setActiveBandId: (bandId) => set({ activeBandId: bandId }),
    }),
    { name: 'bandstand-active-band' },
  ),
);
