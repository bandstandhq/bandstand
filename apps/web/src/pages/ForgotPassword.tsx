// SPDX-License-Identifier: Apache-2.0
import { Button, Input } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { authClient } from '../lib/auth-client';

/**
 * The response is identical whether or not the address exists, and
 * identical again whether or not the server actually sent an email this
 * time (see apps/server/src/lib/passwordResetRateLimit.ts) — so this page
 * only ever has one thing to say once submitted, regardless of outcome.
 * There is deliberately no error state for "that address doesn't exist".
 */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('forgotPassword.title')}</h1>
        {submitted ? (
          <p className="text-sm text-muted-foreground">{t('forgotPassword.sent')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('forgotPassword.description')}</p>
            <div className="space-y-2">
              <label htmlFor="forgot-password-email" className="text-sm text-muted-foreground">
                {t('forgotPassword.email')}
              </label>
              <Input
                id="forgot-password-email"
                type="email"
                required
                value={email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
            </Button>
          </form>
        )}
        <p className="text-sm text-muted-foreground">
          <Link to="/login" className="underline">
            {t('forgotPassword.backToLogin')}
          </Link>
        </p>
      </div>
    </main>
  );
}
