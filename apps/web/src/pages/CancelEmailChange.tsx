// SPDX-License-Identifier: Apache-2.0
//
// Reached from the notice mailed to the OLD address (see
// ChangeEmailForm.tsx, apps/server/src/routes/emailChange.ts) — this is the
// catch for a session hijack the account owner didn't initiate. Unlike
// ConfirmEmailChange.tsx, clicking this never requires anything from the
// new address; it only discards the pending change.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '../lib/api-client';

export function CancelEmailChange() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<'pending' | 'done' | 'error'>(token ? 'pending' : 'error');

  useEffect(() => {
    if (!token) return;
    apiClient
      .cancelEmailChange({ token })
      .then(() => setState('done'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('cancelEmailChange.title')}</h1>
        {state === 'pending' && <p className="text-sm text-muted-foreground">{t('cancelEmailChange.pending')}</p>}
        {state === 'done' && <p className="text-sm text-muted-foreground">{t('cancelEmailChange.done')}</p>}
        {state === 'error' && <p className="text-sm text-destructive">{t('cancelEmailChange.error')}</p>}
        {state !== 'pending' && (
          <Link to="/dashboard" className="text-sm underline">
            {t('cancelEmailChange.continue')}
          </Link>
        )}
      </div>
    </main>
  );
}
