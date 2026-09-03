// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import type { Band } from '@bandstand/core';
import { createBandInputSchema } from '@bandstand/core';
import { Button, Form, FormControl, FormField, FormItem, Input } from '@bandstand/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';

type CreateBandValues = { name: string };

export function CreateBandForm({ onCreated }: { onCreated: (band: Band) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateBandValues>({
    resolver: zodResolver(createBandInputSchema),
    defaultValues: { name: '' },
  });
  const nameValue = useWatch({ control: form.control, name: 'name' });

  async function onSubmit(values: CreateBandValues) {
    setError(null);
    try {
      const band = await apiClient.createBand(values);
      onCreated(band);
    } catch {
      setError(t('bandSwitcher.createError'));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-wrap items-center gap-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input placeholder={t('bandSwitcher.newBandPlaceholder')} className="w-48" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting || !nameValue.trim()}>
          {form.formState.isSubmitting ? t('bandSwitcher.creating') : t('bandSwitcher.createBand')}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>
    </Form>
  );
}
