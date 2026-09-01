// SPDX-License-Identifier: Apache-2.0
//
// Reached from the link mailed to the NEW address (see ChangeEmailForm.tsx,
// apps/server/src/routes/emailChange.ts) — the change only takes effect
// once this confirms, so unlike CancelEmailChange.tsx this one actually
// mutates the account. Deliberately public, same as ResetPassword.tsx: the
// token itself is the credential, the visitor is often not signed in here
// at all (this is a brand-new address that's never logged into Bandstand).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '../lib/api-client';

export function ConfirmEmailChange() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<'pending' | 'done' | 'error'>(token ? 'pending' : 'error');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    if (!token) return;
    apiClient
      .confirmEmailChange({ token })
      .then(({ email }) => {
        setNewEmail(email);
        setState('done');
      })
      .catch(() => setState('error'));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('confirmEmailChange.title')}</h1>
        {state === 'pending' && <p className="text-sm text-muted-foreground">{t('confirmEmailChange.pending')}</p>}
        {state === 'done' && (
          <p className="text-sm text-muted-foreground">{t('confirmEmailChange.done', { email: newEmail })}</p>
        )}
        {state === 'error' && <p className="text-sm text-destructive">{t('confirmEmailChange.error')}</p>}
        {state !== 'pending' && (
          <Link to="/dashboard" className="text-sm underline">
            {t('confirmEmailChange.continue')}
          </Link>
        )}
      </div>
    </main>
  );
}
