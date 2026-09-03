// SPDX-License-Identifier: Apache-2.0
import { Button, Input, PasswordInput } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ServerPicker } from '../components/ServerPicker';
import { authClient } from '../lib/auth-client';
import { clearDraftEmail, getDraftEmail, setDraftEmail } from '../lib/authFormDraft';

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Restores whatever was typed here before a server switch (ServerPicker's
  // save does a real page reload) — see authFormDraft.ts.
  const [email, setEmail] = useState(getDraftEmail);
  const [password, setPassword] = useState('');
  // Deliberately distinct from a plain boolean: a request that never got a
  // response from the server (unreachable host, blocked by CORS, DNS
  // failure — see authClient's underlying better-fetch, which lets a raw
  // fetch() rejection propagate as a thrown error rather than turning it
  // into an { error } result) looks nothing like a real "wrong password"
  // rejection (a definite 401 response), and must never be reported as
  // one — that sends someone hunting for a typo in a password that was
  // never actually checked.
  const [errorKind, setErrorKind] = useState<'credentials' | 'network' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { refetch } = authClient.useSession();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorKind(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await authClient.signIn.email({ email, password });
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <ServerPicker />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <h1 className="text-lg font-medium text-card-foreground">{t('login.title')}</h1>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            {t('login.email')}
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setEmail(e.target.value);
              setDraftEmail(e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm text-muted-foreground">
              {t('login.password')}
            </label>
            <Link to="/forgot-password" className="text-sm text-muted-foreground underline">
              {t('login.forgotPassword')}
            </Link>
          </div>
          <PasswordInput
            id="password"
            required
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            showLabel={t('common.showPassword')}
            hideLabel={t('common.hidePassword')}
          />
        </div>
        {errorKind === 'credentials' && <p className="text-sm text-destructive">{t('login.error')}</p>}
        {errorKind === 'network' && <p className="text-sm text-destructive">{t('login.networkError')}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
        <p className="text-sm text-muted-foreground">
          {t('login.noAccount')}{' '}
          <Link to="/signup" className="underline">
            {t('login.signUp')}
          </Link>
        </p>
      </form>
    </main>
  );
}
