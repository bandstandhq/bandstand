// SPDX-License-Identifier: Apache-2.0
import { Button, Input } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient } from '../lib/auth-client';

export function ChangeNameForm({ currentName }: { currentName: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === currentName;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    setSubmitting(true);
    setError(false);
    setDone(false);
    try {
      const { error: updateError } = await authClient.updateUser({ name: trimmed });
      if (updateError) {
        setError(true);
        return;
      }
      setDone(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('accountSettings.nameLabel')}</span>
        <Input
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
            setDone(false);
          }}
          required
        />
      </label>
      {error && <p className="text-sm text-destructive">{t('accountSettings.nameError')}</p>}
      {done && <p className="text-sm text-muted-foreground">{t('accountSettings.nameSaved')}</p>}
      <Button type="submit" size="sm" disabled={submitting || !trimmed || unchanged}>
        {submitting ? t('accountSettings.nameSaving') : t('accountSettings.nameSave')}
      </Button>
    </form>
  );
}
