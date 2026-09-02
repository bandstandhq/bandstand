// SPDX-License-Identifier: Apache-2.0
import type { Band } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';

export function CreateBandForm({ onCreated }: { onCreated: (band: Band) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const band = await apiClient.createBand({ name });
      onCreated(band);
    } catch {
      setError(t('bandSwitcher.createError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('bandSwitcher.newBandPlaceholder')}
        className="w-48"
      />
      <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
        {submitting ? t('bandSwitcher.creating') : t('bandSwitcher.createBand')}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}
