// SPDX-License-Identifier: Apache-2.0
//
// Keeps the email typed into the login/signup form across a full page
// reload — specifically, switching the server via ServerPicker.tsx does a
// real `window.location.href` navigation (not client-side), which would
// otherwise silently wipe whatever the user had already typed. Session-
// scoped (not localStorage): there's no reason a half-typed email should
// survive closing the tab, and unlike authToken.ts this isn't tied to
// *which* server is active, so it doesn't need clearing when the server
// override changes either.
const STORAGE_KEY = 'bandstand.authFormEmailDraft';

export function getDraftEmail(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setDraftEmail(email: string): void {
  try {
    if (email) sessionStorage.setItem(STORAGE_KEY, email);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (Safari private mode etc.) — the field just won't survive a reload.
  }
}

/** Called once the email has done its job (a successful sign-in/sign-up) — nothing left to restore. */
export function clearDraftEmail(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
