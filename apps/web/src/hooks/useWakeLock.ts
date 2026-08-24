// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react';

/**
 * Keeps the screen from sleeping while `active`. Uses the Screen Wake
 * Lock API where available; the browser auto-releases the lock when the
 * tab is hidden, so this re-acquires on visibility return. Where the API
 * isn't available at all (older Safari/WebViews), falls back to a
 * muted, invisible, looping 1x1 canvas-captured video — a well-known
 * trick that keeps some of those browsers from sleeping, with no new
 * dependency.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;

    if ('wakeLock' in navigator) {
      let sentinel: WakeLockSentinel | null = null;
      let cancelled = false;

      async function acquire() {
        try {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) {
            lock.release().catch(() => {});
            return;
          }
          sentinel = lock;
        } catch {
          // Not fatal — the app is just as usable without it, e.g. if the
          // browser denies it for lacking user activation.
        }
      }

      function handleVisibilityChange() {
        if (document.visibilityState === 'visible' && !sentinel) acquire();
      }

      acquire();
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        sentinel?.release().catch(() => {});
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx?.fillRect(0, 0, 1, 1);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';

    const canvasWithCapture = canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
    if (!canvasWithCapture.captureStream) return undefined;
    video.srcObject = canvasWithCapture.captureStream(1);
    document.body.appendChild(video);
    video.play().catch(() => {});

    return () => {
      video.pause();
      video.remove();
    };
  }, [active]);
}
