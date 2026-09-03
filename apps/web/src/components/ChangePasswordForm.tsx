// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, PasswordInput } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { authClient } from '../lib/auth-client';

type ChangePasswordErrorKind = 'network' | 'rateLimit' | 'wrongCurrent' | 'tooShort' | 'generic' | null;

function classifyError(error: { status: number; code?: string } | null, thrown: boolean): ChangePasswordErrorKind {
  if (thrown) return 'network';
  if (!error) return null;
  if (error.status === 429) return 'rateLimit';
  if (error.code === 'INVALID_PASSWORD') return 'wrongCurrent';
  if (error.code === 'PASSWORD_TOO_SHORT') return 'tooShort';
  return 'generic';
}

// `message` values are i18n keys, not display text — packages/ui's Form has
// no i18n context of its own (see PasswordInput's showLabel/hideLabel), so
// each field below translates its own error via `t()` rather than rendering
// FormMessage's raw fallback.
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'accountSettings.passwordError_tooShort'),
    confirmPassword: z.string().min(8, 'accountSettings.passwordError_tooShort'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'accountSettings.passwordError_mismatch',
    path: ['confirmPassword'],
  });
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [errorKind, setErrorKind] = useState<ChangePasswordErrorKind>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setErrorKind(null);
    setDone(false);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        setErrorKind(classifyError(error, false));
        return;
      }
      form.reset();
      setDone(true);
    } catch {
      setErrorKind(classifyError(null, true));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('accountSettings.currentPassword')}</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  required
                  showLabel={t('common.showPassword')}
                  hideLabel={t('common.hidePassword')}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('accountSettings.newPassword')}</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  required
                  minLength={8}
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
              <FormLabel>{t('accountSettings.confirmNewPassword')}</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  required
                  minLength={8}
                  showLabel={t('common.showPassword')}
                  hideLabel={t('common.hidePassword')}
                />
              </FormControl>
              <FormMessage>{fieldState.error && t(fieldState.error.message ?? '')}</FormMessage>
            </FormItem>
          )}
        />
        {errorKind && <p className="text-sm text-destructive">{t(`accountSettings.passwordError_${errorKind}`)}</p>}
        {done && <p className="text-sm text-muted-foreground">{t('accountSettings.passwordSaved')}</p>}
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('accountSettings.passwordSaving') : t('accountSettings.passwordSave')}
        </Button>
      </form>
    </Form>
  );
}
