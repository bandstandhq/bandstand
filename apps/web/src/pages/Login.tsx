// SPDX-License-Identifier: Apache-2.0
import { Button, Input } from '@bandstand/ui';
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    if (signInError) {
      setError(true);
      return;
    }
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
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
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
