// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from '@bandstand/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { authClient } from '../lib/auth-client';

const changeNameSchema = z.object({ name: z.string().trim().min(1) });
type ChangeNameValues = z.infer<typeof changeNameSchema>;

export function ChangeNameForm({ currentName }: { currentName: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const form = useForm<ChangeNameValues>({
    resolver: zodResolver(changeNameSchema),
    defaultValues: { name: currentName },
  });

  const nameValue = useWatch({ control: form.control, name: 'name' });
  const unchanged = nameValue.trim() === currentName;

  async function onSubmit(values: ChangeNameValues) {
    if (unchanged) return;
    setError(false);
    setDone(false);
    try {
      const { error: updateError } = await authClient.updateUser({ name: values.name });
      if (updateError) {
        setError(true);
        return;
      }
      setDone(true);
    } catch {
      setError(true);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('accountSettings.nameLabel')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    setDone(false);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && <p className="text-sm text-destructive">{t('accountSettings.nameError')}</p>}
        {done && <p className="text-sm text-muted-foreground">{t('accountSettings.nameSaved')}</p>}
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting || unchanged}>
          {form.formState.isSubmitting ? t('accountSettings.nameSaving') : t('accountSettings.nameSave')}
        </Button>
      </form>
    </Form>
  );
}
