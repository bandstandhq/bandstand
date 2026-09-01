// SPDX-License-Identifier: Apache-2.0
import { ApiRequestError } from '@bandstand/api-client';
import { Button, Input } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';

type ChangeEmailErrorKind = 'network' | 'rateLimit' | 'sameEmail' | 'generic' | null;

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorKind, setErrorKind] = useState<ChangeEmailErrorKind>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorKind(null);
    setSubmitting(true);
    try {
      await apiClient.requestEmailChange({
        newEmail,
        confirmUrl: `${window.location.origin}/account/confirm-email-change`,
        cancelUrl: `${window.location.origin}/account/cancel-email-change`,
      });
      setSent(true);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 429) setErrorKind('rateLimit');
        else if (error.status === 400) setErrorKind('sameEmail');
        else setErrorKind('generic');
      } else {
        setErrorKind('network');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Same enumeration-safe shape as ForgotPassword.tsx: once sent, there's
  // exactly one thing to say, regardless of whether newEmail was actually
  // available — the server never reveals that either way.
  if (sent) {
    return <p className="text-sm text-muted-foreground">{t('accountSettings.emailSent')}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('accountSettings.emailCurrent', { email: currentEmail })}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('accountSettings.emailNewLabel')}</span>
        <Input
          type="email"
          required
          value={newEmail}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value)}
        />
      </label>
      {errorKind && <p className="text-sm text-destructive">{t(`accountSettings.emailError_${errorKind}`)}</p>}
      <Button type="submit" size="sm" disabled={submitting || !newEmail}>
        {submitting ? t('accountSettings.emailSaving') : t('accountSettings.emailSave')}
      </Button>
    </form>
  );
}
