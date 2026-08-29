// SPDX-License-Identifier: Apache-2.0
import { Button, PasswordInput } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { authClient } from '../lib/auth-client';

export function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(false);
    const { error: resetError } = await authClient.resetPassword({ newPassword, token });
    setSubmitting(false);
    if (resetError) {
      setError(true);
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('resetPassword.title')}</h1>
        {!token ? (
          <p className="text-sm text-destructive">{t('resetPassword.missingToken')}</p>
        ) : done ? (
          <>
            <p className="text-sm text-muted-foreground">{t('resetPassword.done')}</p>
            <Link to="/login" className="text-sm underline">
              {t('resetPassword.goToLogin')}
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="reset-new-password" className="text-sm text-muted-foreground">
                {t('resetPassword.newPassword')}
              </label>
              <PasswordInput
                id="reset-new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
                showLabel={t('common.showPassword')}
                hideLabel={t('common.hidePassword')}
              />
            </div>
            {error && <p className="text-sm text-destructive">{t('resetPassword.error')}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
