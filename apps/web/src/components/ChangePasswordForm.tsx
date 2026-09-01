// SPDX-License-Identifier: Apache-2.0
import { Button, PasswordInput } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient } from '../lib/auth-client';

type ChangePasswordErrorKind = 'network' | 'rateLimit' | 'wrongCurrent' | 'tooShort' | 'mismatch' | 'generic' | null;

function classifyError(error: { status: number; code?: string } | null, thrown: boolean): ChangePasswordErrorKind {
  if (thrown) return 'network';
  if (!error) return null;
  if (error.status === 429) return 'rateLimit';
  if (error.code === 'INVALID_PASSWORD') return 'wrongCurrent';
  if (error.code === 'PASSWORD_TOO_SHORT') return 'tooShort';
  return 'generic';
}

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorKind, setErrorKind] = useState<ChangePasswordErrorKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorKind(null);
    setDone(false);

    if (newPassword !== confirmPassword) {
      setErrorKind('mismatch');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        setErrorKind(classifyError(error, false));
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDone(true);
    } catch {
      setErrorKind(classifyError(null, true));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('accountSettings.currentPassword')}</span>
        <PasswordInput
          value={currentPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
          required
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('accountSettings.newPassword')}</span>
        <PasswordInput
          value={newPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
          required
          minLength={8}
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('accountSettings.confirmNewPassword')}</span>
        <PasswordInput
          value={confirmPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
        />
      </label>
      {errorKind && <p className="text-sm text-destructive">{t(`accountSettings.passwordError_${errorKind}`)}</p>}
      {done && <p className="text-sm text-muted-foreground">{t('accountSettings.passwordSaved')}</p>}
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? t('accountSettings.passwordSaving') : t('accountSettings.passwordSave')}
      </Button>
    </form>
  );
}
