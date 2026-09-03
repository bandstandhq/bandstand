// SPDX-License-Identifier: Apache-2.0
import { Button, Form, FormControl, FormField, FormItem, FormLabel, Input, PasswordInput } from '@bandstand/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { authClient } from '../lib/auth-client';
import { clearDraftEmail, getDraftEmail, setDraftEmail } from '../lib/authFormDraft';

// Every code that can come back is bucketed into one of these — anything
// else (a code this app doesn't know about yet, or none at all) falls into
// 'generic'. USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL is deliberately bucketed
// into 'generic' too, never its own case: telling someone "that address is
// already registered" is exactly the account-enumeration leak this form
// must not have, so it gets the same wording as a real server hiccup —
// indistinguishable on purpose.
type SignupErrorKind = 'network' | 'rateLimit' | 'invalidEmail' | 'passwordTooShort' | 'generic' | null;

function classifySignupError(error: { status: number; code?: string } | null, thrown: boolean): SignupErrorKind {
  if (thrown) return 'network';
  if (!error) return null;
  if (error.status === 429) return 'rateLimit';
  if (error.code === 'INVALID_EMAIL') return 'invalidEmail';
  if (error.code === 'PASSWORD_TOO_SHORT' || error.code === 'INVALID_PASSWORD') return 'passwordTooShort';
  return 'generic';
}

interface SignupValues {
  name: string;
  email: string;
  password: string;
}

export function SignupForm({ onSuccess, submitLabel }: { onSuccess: () => void; submitLabel?: string }) {
  const { t } = useTranslation();
  const [errorKind, setErrorKind] = useState<SignupErrorKind>(null);
  const { refetch } = authClient.useSession();

  const form = useForm<SignupValues>({
    // Restores whatever was typed here before a server switch (ServerPicker's
    // save does a real page reload) — see authFormDraft.ts.
    defaultValues: { name: '', email: getDraftEmail(), password: '' },
  });

  async function onSubmit(values: SignupValues) {
    setErrorKind(null);
    try {
      const { error: signUpError } = await authClient.signUp.email(values);
      if (signUpError) {
        setErrorKind(classifySignupError(signUpError, false));
        return;
      }
      // Same fix as Login.tsx: force the shared session store to refresh
      // before anything reacts to "we're signed in now" — signUp.email only
      // marks it stale, it doesn't refetch it itself.
      await refetch();
      clearDraftEmail();
      onSuccess();
    } catch {
      // The request itself never completed (unreachable host, DNS, CORS) —
      // see Login.tsx's identical reasoning for why this can never be
      // worded as a credentials/validation problem.
      setErrorKind('network');
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('signup.name')}</FormLabel>
              <FormControl>
                <Input required {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('signup.email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  required
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    setDraftEmail(e.target.value);
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('signup.password')}</FormLabel>
              <FormControl>
                <PasswordInput
                  required
                  minLength={8}
                  {...field}
                  showLabel={t('common.showPassword')}
                  hideLabel={t('common.hidePassword')}
                />
              </FormControl>
            </FormItem>
          )}
        />
        {errorKind === 'network' && <p className="text-sm text-destructive">{t('signup.networkError')}</p>}
        {errorKind === 'rateLimit' && <p className="text-sm text-destructive">{t('signup.rateLimitError')}</p>}
        {errorKind === 'invalidEmail' && <p className="text-sm text-destructive">{t('signup.invalidEmailError')}</p>}
        {errorKind === 'passwordTooShort' && (
          <p className="text-sm text-destructive">{t('signup.passwordTooShortError')}</p>
        )}
        {errorKind === 'generic' && <p className="text-sm text-destructive">{t('signup.error')}</p>}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {submitLabel ?? t('signup.submit')}
        </Button>
      </form>
    </Form>
  );
}
