// SPDX-License-Identifier: Apache-2.0
//
// Browser-side half of web push subscribing — the server-side counterpart
// (subscribe/unsubscribe routes, VAPID keys) is apps/server/src/routes/push.ts.

/** The Push API wants the VAPID public key as a raw Uint8Array, not the base64url string the server hands out. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Requests notification permission (must be called from a direct user
 * gesture, e.g. a button click — never on page load, since a permission
 * prompt shown unprompted gets reflexively denied and iOS/most browsers
 * then block asking again) and subscribes this device if granted.
 * Returns `null` without subscribing if permission is denied.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribeFromPush(subscription: PushSubscription): Promise<void> {
  await subscription.unsubscribe();
}
