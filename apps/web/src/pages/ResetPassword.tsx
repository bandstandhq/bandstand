// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, PasswordInput } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { authClient } from '../lib/auth-client';

// `message` is an i18n key, not display text — packages/ui's Form has no
// i18n context of its own, so the confirm field translates its own error
// via `t()` rather than rendering FormMessage's raw fallback (same
// reasoning as ChangePasswordForm's schema).
const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'accountSettings.passwordError_tooShort'),
    confirmPassword: z.string().min(8, 'accountSettings.passwordError_tooShort'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'resetPassword.mismatchError',
    path: ['confirmPassword'],
  });
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ResetPasswordValues) {
    if (!token) return;
    setError(false);
    const { error: resetError } = await authClient.resetPassword({ newPassword: values.newPassword, token });
    if (resetError) {
      setError(true);
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('resetPassword.title')}</h1>
        {!token ? (
          <p className="text-sm text-destructive">{t('resetPassword.missingToken')}</p>
        ) : done ? (
          <>
            <p className="text-sm text-muted-foreground">{t('resetPassword.done')}</p>
            <Link to="/login" className="text-sm underline">
              {t('resetPassword.goToLogin')}
            </Link>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('resetPassword.newPassword')}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        required
                        minLength={8}
                        {...field}
                        showLabel={t('common.showPassword')}
                        hideLabel={t('common.hidePassword')}
                      />
                    </FormControl>
                    <FormMessage>{fieldState.error && t(fieldState.error.message ?? '')}</FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('resetPassword.confirmNewPassword')}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        required
                        minLength={8}
                        {...field}
                        showLabel={t('common.showPassword')}
                        hideLabel={t('common.hidePassword')}
                      />
                    </FormControl>
                    <FormMessage>{fieldState.error && t(fieldState.error.message ?? '')}</FormMessage>
                  </FormItem>
                )}
              />
              {error && <p className="text-sm text-destructive">{t('resetPassword.error')}</p>}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
              </Button>
            </form>
          </Form>
        )}
      </div>
    </main>
  );
}
