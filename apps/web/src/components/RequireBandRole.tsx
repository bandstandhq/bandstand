// SPDX-License-Identifier: Apache-2.0
import type { BandRole } from '@bandstand/core';
import { hasAtLeastRole } from '@bandstand/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';

/**
 * Gates an entire area on "is the caller at least `role` in this band" —
 * distinct from the per-action can() checks a page uses internally to hide
 * specific buttons (docs/adr/0005-permissions.md). BandSettings had no
 * membership check at all before this (unlike every useBandDoc-backed page,
 * which gets one for free via ADR-0006); this closes that gap.
 */
export function RequireBandRole({
  bandId,
  role,
  fallback = null,
  children,
}: {
  bandId: string;
  role: BandRole;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const [myRole, setMyRole] = useState<BandRole | null | undefined>(undefined);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listMyBands()
      .then((bands) => {
        if (cancelled) return;
        setMyRole(bands.find((b) => b.id === bandId)?.role ?? null);
      })
      .catch(() => {
        // Offline/unreachable — without this, myRole stays `undefined`
        // forever and this whole area renders null forever (a real reported
        // bug: reloading a role-gated page like BandSettings while offline
        // showed nothing at all). This is a UX gate, not the security
        // boundary — every real mutation this area could trigger is
        // independently re-checked server-side — so showing the gated
        // content when the check itself couldn't complete costs nothing a
        // genuine permission denial wouldn't already catch on its own next
        // real request.
        if (cancelled) return;
        setCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bandId]);

  if (checkFailed) return <>{children}</>;
  if (myRole === undefined) return null;
  if (myRole === null || !hasAtLeastRole(myRole, role)) return <>{fallback}</>;
  return <>{children}</>;
}
