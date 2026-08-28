// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Web Push is opt-in infrastructure — a self-hoster who never runs
// `pnpm push:keys` still gets a server that starts and serves everything
// else normally. Every send path checks `hasVapidKeys()` first and no-ops
// rather than throwing; `warnOnceIfMissing()` is the one place that logs
// about it, called once at boot, so a missing key isn't a silent surprise
// but also never spams the log per-request.
// Read fresh on every call, not cached at module load — both so tests can
// toggle `process.env` between cases, and so a self-hoster who fixes their
// `.env` doesn't need to know this module also needs a fresh process.
export function hasVapidKeys(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set — check hasVapidKeys() before calling this.');
  }
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com' };
}

let warned = false;

/** Called once at server boot (see index.ts) — never on a per-request path. */
export function warnOnceIfMissing(): void {
  if (warned || hasVapidKeys()) return;
  warned = true;
  console.warn(
    'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set — web push notifications are disabled. ' +
      'Run `pnpm push:keys` and add the printed values to .env to enable them.',
  );
}
