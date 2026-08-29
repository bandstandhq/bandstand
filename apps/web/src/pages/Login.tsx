// SPDX-License-Identifier: Apache-2.0
import { Button, Input, PasswordInput } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../lib/auth-client';

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const { refetch } = authClient.useSession();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    if (signInError) {
      setError(true);
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
    navigate(searchParams.get('next') ?? '/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm text-muted-foreground">
            {t('login.password')}
          </label>
          <PasswordInput
            id="password"
            required
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            showLabel={t('common.showPassword')}
            hideLabel={t('common.hidePassword')}
          />
        </div>
        {error && <p className="text-sm text-destructive">{t('login.error')}</p>}
        <Button type="submit" className="w-full">
          {t('login.submit')}
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
