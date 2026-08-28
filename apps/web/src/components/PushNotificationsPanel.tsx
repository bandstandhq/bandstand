// SPDX-License-Identifier: Apache-2.0
//
// Personal, cross-band, same placement as Dashboard's CalendarSubscribePanel
// — settings that apply to this user everywhere, not to one band. Hidden
// entirely when the browser doesn't support the Push API, or the server
// has no VAPID keys configured (self-hoster hasn't run `pnpm push:keys`).
import { DEFAULT_PUSH_TRIGGERS } from '@bandstand/core';
import type { PushTriggers } from '@bandstand/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushSubscription';

const TRIGGERS: (keyof PushTriggers)[] = [
  'eventCreated',
  'eventChanged',
  'pollCreated',
  'missingResponseReminder',
  'upcomingEventReminder',
];

export function PushNotificationsPanel() {
  const { t } = useTranslation();
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null | undefined>(() =>
    isPushSupported() ? undefined : null,
  );
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined);
  const [triggers, setTriggers] = useState<PushTriggers>(DEFAULT_PUSH_TRIGGERS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) return;
    apiClient.getPushPublicKey().then((r) => setVapidPublicKey(r.publicKey));
    getExistingPushSubscription().then(setSubscription);
    apiClient.getMyPrefs().then((prefs) => setTriggers(prefs.pushTriggers));
  }, []);

  if (!vapidPublicKey) return null;

  async function handleToggleSubscription() {
    setBusy(true);
    setError(null);
    try {
      if (subscription) {
        await apiClient.unsubscribePush(subscription.endpoint);
        await unsubscribeFromPush(subscription);
        setSubscription(null);
      } else {
        const newSubscription = await subscribeToPush(vapidPublicKey!);
        if (!newSubscription) {
          setError(t('pushNotifications.permissionDenied'));
          return;
        }
        const json = newSubscription.toJSON();
        await apiClient.subscribePush({
          endpoint: newSubscription.endpoint,
          keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
        });
        setSubscription(newSubscription);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTrigger(trigger: keyof PushTriggers) {
    const enabled = !triggers[trigger];
    setTriggers((prev) => ({ ...prev, [trigger]: enabled }));
    try {
      await apiClient.updatePushPref(trigger, enabled);
    } catch {
      // Best-effort — revert the optimistic toggle if the save failed.
      setTriggers((prev) => ({ ...prev, [trigger]: !enabled }));
    }
  }

  return (
    <div className="mt-8 rounded-md border border-border p-4">
      <h2 className="font-medium">{t('pushNotifications.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('pushNotifications.description')}</p>

      <button
        type="button"
        disabled={busy}
        onClick={() => void handleToggleSubscription()}
        className="mt-3 flex h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-accent/50 disabled:opacity-50"
      >
        {subscription ? t('pushNotifications.disableOnThisDevice') : t('pushNotifications.enableOnThisDevice')}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 space-y-2">
        {TRIGGERS.map((trigger) => (
          <label key={trigger} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={triggers[trigger]} onChange={() => void handleToggleTrigger(trigger)} />
            {t(`pushNotifications.trigger_${trigger}`)}
          </label>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t('pushNotifications.iosCaveat')}</p>
    </div>
  );
}
