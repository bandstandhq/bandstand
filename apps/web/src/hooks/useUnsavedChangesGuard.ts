// SPDX-License-Identifier: Apache-2.0
//
// Confirms before leaving a page with unsaved form data — via an in-app
// link click, the browser's own back button, or (implicitly) the hardware
// back gesture on mobile, all of which fire the same events this relies on.
// There is no react-router primitive for this here: useBlocker/usePrompt
// only work inside a data router (createBrowserRouter + RouterProvider),
// and this app is wired declaratively (BrowserRouter + Routes) — see the
// investigation behind this file for the exact error that throws if you
// try. So this reimplements the two building blocks by hand, each with a
// precedent already in this codebase:
//   - link interception: a document-level capture-phase click listener,
//     the same technique SortableSetlistItem (SetlistDetail.tsx) already
//     uses to stop a drag's trailing click from navigating.
//   - back-button interception: push a synthetic history entry and react
//     to popstate, the same pushState/popstate pairing AppHeader's own
//     Sheet menu uses to make the hardware back button close the menu
//     instead of leaving the page.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

export type PendingLeave = { kind: 'link'; href: string } | { kind: 'back' };

export function useUnsavedChangesGuard(isDirty: boolean) {
  const navigate = useNavigate();
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const [pending, setPending] = useState<PendingLeave | null>(null);

  // Link clicks: registered once, not per isDirty change — isDirtyRef stays
  // current regardless, and the alternative (churning the listener on every
  // dirty/clean flip) buys nothing.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!isDirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest('a[href]');
      if (!anchor) return;
      if (anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      event.preventDefault();
      setPending({ kind: 'link', href: url.pathname + url.search + url.hash });
    }
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  // Back button: armed only while dirty. A real back-press moves the
  // browser one entry back (to a same-URL entry pushed below — see below);
  // re-pushing immediately cancels that instead of actually leaving, since
  // there's no preventDefault() for popstate.
  useEffect(() => {
    if (!isDirty) return undefined;
    window.history.pushState({ unsavedChangesGuard: true }, '');

    function handlePopState() {
      window.history.pushState({ unsavedChangesGuard: true }, '');
      setPending({ kind: 'back' });
    }
    window.addEventListener('popstate', handlePopState);
    // Deliberately no unwind here (no history.back() to pop the pushed
    // entry) once the effect cleans up on a clean save — same trade-off
    // SortableSetlistItem's own drag-vs-navigate guard already accepts: a
    // stray same-URL history entry, invisible until the next stray back
    // press, never a wrong page.
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isDirty]);

  function continueEditing() {
    setPending(null);
  }

  // Goes to wherever the intercepted navigation was headed — used directly
  // by "Discard" and, after a successful save, by "Save" too: both end in
  // the same place, the only difference is whether anything was written
  // first.
  function leave() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === 'link') {
      navigate(action.href);
    } else {
      // Two steps back, always: one for the same-URL guard entry the popstate
      // handler just re-armed, one more for the same-URL entry underneath it
      // (pushed when the guard first armed) — only the entry below both of
      // those is a real, different page. See the module comment above.
      window.history.go(-2);
    }
  }

  return { pending, continueEditing, leave };
}
