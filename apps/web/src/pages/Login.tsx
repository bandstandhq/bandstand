// SPDX-License-Identifier: Apache-2.0
import { Button, Form, FormControl, FormField, FormItem, FormLabel, Input, PasswordInput } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ServerPicker } from '../components/ServerPicker';
import { authClient } from '../lib/auth-client';
import { clearDraftEmail, getDraftEmail, setDraftEmail } from '../lib/authFormDraft';

interface LoginValues {
  email: string;
  password: string;
}

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Deliberately distinct from a plain boolean: a request that never got a
  // response from the server (unreachable host, blocked by CORS, DNS
  // failure — see authClient's underlying better-fetch, which lets a raw
  // fetch() rejection propagate as a thrown error rather than turning it
  // into an { error } result) looks nothing like a real "wrong password"
  // rejection (a definite 401 response), and must never be reported as
  // one — that sends someone hunting for a typo in a password that was
  // never actually checked.
  const [errorKind, setErrorKind] = useState<'credentials' | 'network' | null>(null);
  const { refetch } = authClient.useSession();

  const form = useForm<LoginValues>({
    // Restores whatever was typed here before a server switch (ServerPicker's
    // save does a real page reload) — see authFormDraft.ts.
    defaultValues: { email: getDraftEmail(), password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setErrorKind(null);
    try {
      const { error: signInError } = await authClient.signIn.email(values);
      if (signInError) {
        // A non-2xx response the server actually sent — status 401 is the
        // real "wrong email or password"; anything else (a 5xx, a rate
        // limit) is a server-side problem, not a credentials problem, and
        // must not be worded as one either.
        setErrorKind(signInError.status === 401 ? 'credentials' : 'network');
        return;
      }
      // signIn.email only marks the shared session store stale — it doesn't
      // itself trigger a refetch. If that store already settled to
      // "anonymous" earlier in this tab (e.g. an anonymous visit to a
      // protected route redirected here first), it stays stale until
      // something re-fetches it. Without this, navigating immediately can
      // land on a page whose own useSession() call still reads that stale
      // anonymous state on its very first render and bounces straight back
      // to /login — the exact "sometimes redirects, sometimes doesn't" bug.
      await refetch();
      clearDraftEmail();
      navigate(searchParams.get('next') ?? '/dashboard');
    } catch {
      // The request itself never completed — no response to have been
      // wrong about, so this is never a credentials error.
      setErrorKind('network');
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <ServerPicker />
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
        >
          <h1 className="text-lg font-medium text-card-foreground">{t('login.title')}</h1>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('login.email')}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    required
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      setDraftEmail(e.target.value);
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>{t('login.password')}</FormLabel>
                  <Link to="/forgot-password" className="text-sm text-muted-foreground underline">
                    {t('login.forgotPassword')}
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    required
                    {...field}
                    showLabel={t('common.showPassword')}
                    hideLabel={t('common.hidePassword')}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {errorKind === 'credentials' && <p className="text-sm text-destructive">{t('login.error')}</p>}
          {errorKind === 'network' && <p className="text-sm text-destructive">{t('login.networkError')}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('login.noAccount')}{' '}
            <Link to="/signup" className="underline">
              {t('login.signUp')}
            </Link>
          </p>
        </form>
      </Form>
    </main>
  );
}
