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
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  Input,
  RadioGroup,
  RadioGroupItem,
} from '@bandstand/ui';
import { type FormEvent, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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

interface ServerPickerValues {
  mode: 'default' | 'custom';
  serverUrl: string;
  hocuspocusUrl: string;
}

export function ServerPicker() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const active = getActiveServerConfig();
  const [error, setError] = useState(false);
  const form = useForm<ServerPickerValues>({
    defaultValues: {
      mode: isUsingCustomServer() ? 'custom' : 'default',
      serverUrl: isUsingCustomServer() ? active.serverUrl : '',
      hocuspocusUrl: isUsingCustomServer() ? active.hocuspocusUrl : '',
    },
  });
  const values = useWatch({ control: form.control });

  if (import.meta.env.DEV) return null;

  // A plain event handler passed directly to onSubmit below, not routed
  // through form.handleSubmit(...) — this function's own page navigation
  // (window.location.href) is exactly the kind of external mutation React
  // Compiler only recognizes as safe for a function used directly as a JSX
  // event-handler prop, not one nested inside another callback.
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    const formValues = form.getValues();

    if (formValues.mode === 'default') {
      clearServerOverride();
    } else {
      if (!isValidUrl(formValues.serverUrl, ['http:', 'https:']) || !isValidUrl(formValues.hocuspocusUrl, ['ws:', 'wss:'])) {
        setError(true);
        return;
      }
      setServerOverride({ serverUrl: formValues.serverUrl, hocuspocusUrl: formValues.hocuspocusUrl });
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
    <Form {...form}>
      <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-md border border-border bg-card p-4 text-sm">
        <FormField
          control={form.control}
          name="mode"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <RadioGroup value={field.value} onValueChange={field.onChange}>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="default" />
                    {t('serverPicker.default')} ({DEFAULT_SERVER_CONFIG.serverUrl})
                  </label>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="custom" />
                    {t('serverPicker.custom')}
                  </label>
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />
        {values.mode === 'custom' && (
          <div className="space-y-2 pl-6">
            <FormField
              control={form.control}
              name="serverUrl"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">{t('serverPicker.serverUrlLabel')}</span>
                    <FormControl>
                      <Input type="text" placeholder="https://bandstand.example.com" {...field} />
                    </FormControl>
                  </label>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hocuspocusUrl"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">{t('serverPicker.hocuspocusUrlLabel')}</span>
                    <FormControl>
                      <Input type="text" placeholder="wss://bandstand.example.com" {...field} />
                    </FormControl>
                  </label>
                </FormItem>
              )}
            />
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
    </Form>
  );
}
