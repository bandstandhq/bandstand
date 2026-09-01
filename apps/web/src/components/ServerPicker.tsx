// SPDX-License-Identifier: Apache-2.0
//
// Shown above the login/signup form while signed out — see
// docs/ARCHITECTURE.md's "server URL is configurable, not hardcoded" and
// ADR-0001. Never rendered during `pnpm dev` (serverConfig.ts's override is
// inert there anyway, so a control that visibly did nothing would just be
// confusing). Saving reboots the whole app (a full navigation, not a
// client-side one) rather than trying to re-point the already-constructed
// apiClient/authClient singletons in place — simpler, and correct anyway
// given a server switch is defined to discard all local session/cached data.
import { Button, Input } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  clearServerOverride,
  DEFAULT_SERVER_CONFIG,
  getActiveServerConfig,
  isUsingCustomServer,
  setServerOverride,
} from '../lib/serverConfig';

function isValidUrl(value: string, schemes: string[]): boolean {
  try {
    return schemes.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function ServerPicker() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'default' | 'custom'>(isUsingCustomServer() ? 'custom' : 'default');
  const active = getActiveServerConfig();
  const [serverUrl, setServerUrl] = useState(isUsingCustomServer() ? active.serverUrl : '');
  const [hocuspocusUrl, setHocuspocusUrl] = useState(isUsingCustomServer() ? active.hocuspocusUrl : '');
  const [error, setError] = useState(false);

  if (import.meta.env.DEV) return null;

  function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(false);

    if (mode === 'default') {
      clearServerOverride();
    } else {
      if (!isValidUrl(serverUrl, ['http:', 'https:']) || !isValidUrl(hocuspocusUrl, ['ws:', 'wss:'])) {
        setError(true);
        return;
      }
      setServerOverride({ serverUrl, hocuspocusUrl });
    }

    window.location.href = '/login';
  }

  if (!expanded) {
    return (
      <p className="mb-2 text-center text-sm text-muted-foreground">
        {t('serverPicker.current', { server: isUsingCustomServer() ? active.serverUrl : t('serverPicker.default') })}{' '}
        <button type="button" onClick={() => setExpanded(true)} className="underline">
          {t('serverPicker.change')}
        </button>
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSave}
      className="mb-4 space-y-3 rounded-md border border-border bg-card p-4 text-sm"
    >
      <label className="flex items-center gap-2">
        <input type="radio" checked={mode === 'default'} onChange={() => setMode('default')} />
        {t('serverPicker.default')} ({DEFAULT_SERVER_CONFIG.serverUrl})
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
        {t('serverPicker.custom')}
      </label>
      {mode === 'custom' && (
        <div className="space-y-2 pl-6">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('serverPicker.serverUrlLabel')}</span>
            <Input
              type="text"
              placeholder="https://bandstand.example.com"
              value={serverUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('serverPicker.hocuspocusUrlLabel')}</span>
            <Input
              type="text"
              placeholder="wss://bandstand.example.com"
              value={hocuspocusUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setHocuspocusUrl(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && <p className="text-destructive">{t('serverPicker.invalidUrl')}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t('serverPicker.save')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(false)}>
          {t('serverPicker.cancel')}
        </Button>
      </div>
    </form>
  );
}
