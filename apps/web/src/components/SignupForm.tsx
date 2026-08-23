// SPDX-License-Identifier: Apache-2.0
import { Button, Input } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient } from '../lib/auth-client';

export function SignupForm({ onSuccess, submitLabel }: { onSuccess: () => void; submitLabel?: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    const { error: signUpError } = await authClient.signUp.email({ email, password, name });
    setSubmitting(false);
    if (signUpError) {
      setError(true);
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="signup-name" className="text-sm text-muted-foreground">
          {t('signup.name')}
        </label>
        <Input
          id="signup-name"
          required
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm text-muted-foreground">
          {t('signup.email')}
        </label>
        <Input
          id="signup-email"
          type="email"
          required
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-password" className="text-sm text-muted-foreground">
          {t('signup.password')}
        </label>
        <Input
          id="signup-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{t('signup.error')}</p>}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitLabel ?? t('signup.submit')}
      </Button>
    </form>
  );
}
