// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiRequestError } from '@bandstand/api-client';
import { requestEmailChangeInputSchema } from '@bandstand/core';
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';

type ChangeEmailErrorKind = 'network' | 'rateLimit' | 'sameEmail' | 'generic' | null;

const changeEmailSchema = requestEmailChangeInputSchema.pick({ newEmail: true });
type ChangeEmailValues = { newEmail: string };

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [errorKind, setErrorKind] = useState<ChangeEmailErrorKind>(null);

  const form = useForm<ChangeEmailValues>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { newEmail: '' },
  });

  async function onSubmit(values: ChangeEmailValues) {
    setErrorKind(null);
    try {
      await apiClient.requestEmailChange({
        newEmail: values.newEmail,
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
    }
  }

  // Same enumeration-safe shape as ForgotPassword.tsx: once sent, there's
  // exactly one thing to say, regardless of whether newEmail was actually
  // available — the server never reveals that either way.
  if (sent) {
    return <p className="text-sm text-muted-foreground">{t('accountSettings.emailSent')}</p>;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('accountSettings.emailCurrent', { email: currentEmail })}</p>
        <FormField
          control={form.control}
          name="newEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('accountSettings.emailNewLabel')}</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {errorKind && <p className="text-sm text-destructive">{t(`accountSettings.emailError_${errorKind}`)}</p>}
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('accountSettings.emailSaving') : t('accountSettings.emailSave')}
        </Button>
      </form>
    </Form>
  );
}
