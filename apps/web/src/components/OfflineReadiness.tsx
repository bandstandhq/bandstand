// SPDX-License-Identifier: Apache-2.0
//
// Pre-loads every file referenced by an upcoming setlist into the Cache API
// (see docs/adr/0007 for why a content-addressed blob never needs
// revalidating once cached) — see the A4 plan section. Runs on mount and
// again whenever the voices/setlists actually change, not on every render —
// useYMap's return value is a fresh object on every call (see its own
// source), so using it directly as an effect dependency would re-trigger on
// every render this component does for any reason, including the state
// updates the effect itself causes. A stable serialized digest sidesteps
// that entirely.
import { collectUpcomingFileHashes } from '@bandstand/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { useYMap } from '../hooks/useYMap';
import { apiClient } from '../lib/api-client';
import { ensureCached } from '../lib/blobCache';

type Status = 'idle' | 'loading' | 'ready';

export function OfflineReadiness({ bandId, doc }: { bandId: string; doc: Y.Doc }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const voices = useYMap(doc.getMap('voices'));
  const setlists = useYMap(doc.getMap('setlists'));
  const dataDigest = JSON.stringify([voices, setlists]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const hashes = collectUpcomingFileHashes(doc);
      if (hashes.length === 0) {
        if (!cancelled) setStatus('ready');
        return;
      }

      if (!cancelled) {
        setStatus('loading');
        setProgress({ done: 0, total: hashes.length });
      }

      let done = 0;
      for (const sha256 of hashes) {
        if (cancelled) return;
        try {
          await ensureCached(sha256, async () => {
            const { downloadUrl } = await apiClient.presignFileDownload(bandId, sha256);
            return downloadUrl;
          });
        } catch {
          // Offline right now, or a transient failure — this file just
          // isn't ready yet; the next run (e.g. next visit, once back
          // online) tries again. One failure shouldn't block the rest.
        }
        done += 1;
        if (!cancelled) setProgress({ done, total: hashes.length });
      }

      if (!cancelled) setStatus('ready');
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [bandId, doc, dataDigest]);

  if (status === 'idle') return null;

  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {status === 'loading' ? t('offline.preparing', progress) : t('offline.ready')}
    </p>
  );
}
