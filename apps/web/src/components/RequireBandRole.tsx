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

  useEffect(() => {
    let cancelled = false;
    apiClient.listMyBands().then((bands) => {
      if (cancelled) return;
      setMyRole(bands.find((b) => b.id === bandId)?.role ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [bandId]);

  if (myRole === undefined) return null;
  if (myRole === null || !hasAtLeastRole(myRole, role)) return <>{fallback}</>;
  return <>{children}</>;
}
