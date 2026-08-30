// SPDX-License-Identifier: Apache-2.0
//
// A thin in-memory cache of the signed-in user's server-side prefs
// (user_prefs), shared between GlobalPrefsEffects.tsx (which applies them
// app-wide — wake lock, active language) and AccountSettings.tsx (which
// lets the user change them). Deliberately not zustand's `persist` —
// user_prefs is already the durable, cross-device store; caching it again
// in localStorage would just be a second, sometimes-stale copy. Reset on
// sign-out for the same reason activeBand.ts's store is: nothing fetched
// for one user may still be visible (or, here, silently still in effect)
// after the next person signs in on this device.
import { DEFAULT_USER_PREFS, type UpdateUserPrefsInput, type UserPrefs } from '@bandstand/core';
import { create } from 'zustand';
import { apiClient } from '../lib/api-client';

interface UserPrefsState {
  prefs: UserPrefs;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: UpdateUserPrefsInput) => Promise<void>;
  reset: () => void;
}

export const useUserPrefsStore = create<UserPrefsState>((set) => ({
  prefs: DEFAULT_USER_PREFS,
  loaded: false,
  async load() {
    const prefs = await apiClient.getMyPrefs();
    set({ prefs, loaded: true });
  },
  async update(patch) {
    const merged = await apiClient.updateMyPrefs(patch);
    set({ prefs: merged });
  },
  reset() {
    set({ prefs: DEFAULT_USER_PREFS, loaded: false });
  },
}));
