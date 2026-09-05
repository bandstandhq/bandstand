// SPDX-License-Identifier: Apache-2.0
import { Button, Form, FormControl, FormField, FormItem, FormLabel, Input } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { authClient } from '../lib/auth-client';

interface ForgotPasswordValues {
  email: string;
}

/**
 * The response is identical whether or not the address exists, and
 * identical again whether or not the server actually sent an email this
 * time (see apps/server/src/lib/passwordResetRateLimit.ts) — so this page
 * only ever has one thing to say once submitted, regardless of outcome.
 * There is deliberately no error state for "that address doesn't exist".
 */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordValues>({ defaultValues: { email: '' } });

  async function onSubmit(values: ForgotPasswordValues) {
    await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitted(true);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('forgotPassword.title')}</h1>
        {submitted ? (
          <p className="text-sm text-muted-foreground">{t('forgotPassword.sent')}</p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('forgotPassword.description')}</p>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('forgotPassword.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" required {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
              </Button>
            </form>
          </Form>
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
