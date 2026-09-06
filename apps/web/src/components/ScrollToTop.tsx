// SPDX-License-Identifier: Apache-2.0
//
// React Router doesn't do this on its own: since every page is its own
// full route element rather than a persistent layout, navigating between
// them fully remounts the page tree — but that doesn't touch the browser's
// own scroll position, so a page you'd scrolled down on previously renders
// still scrolled down instead of starting at the top. Mounted once, inside
// <BrowserRouter> but outside <Routes> (see router.tsx), so it keeps
// running across every navigation rather than being torn down and rebuilt.
import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function ScrollToTop(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
