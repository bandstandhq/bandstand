// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm push:keys` — prints a fresh VAPID keypair for a self-hoster to
// paste into their `.env` (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). One-time
// setup, not something the server generates for itself on boot — rotating
// the key would silently invalidate every browser's existing subscription.
import webpush from 'web-push';

export function printVapidKeys(): void {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  console.log('Add these to your .env:\n');
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
}

// Only run as a CLI when invoked directly (`pnpm push:keys`), not when
// imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  printVapidKeys();
}
