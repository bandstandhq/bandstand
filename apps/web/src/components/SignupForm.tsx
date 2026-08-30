// SPDX-License-Identifier: Apache-2.0
import { Button, Input, PasswordInput } from '@bandstand/ui';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient } from '../lib/auth-client';

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

export function SignupForm({ onSuccess, submitLabel }: { onSuccess: () => void; submitLabel?: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorKind, setErrorKind] = useState<SignupErrorKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const { refetch } = authClient.useSession();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorKind(null);
    setSubmitting(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({ email, password, name });
      if (signUpError) {
        setErrorKind(classifySignupError(signUpError, false));
        return;
      }
      // Same fix as Login.tsx: force the shared session store to refresh
      // before anything reacts to "we're signed in now" — signUp.email only
      // marks it stale, it doesn't refetch it itself.
      await refetch();
      onSuccess();
    } catch {
      // The request itself never completed (unreachable host, DNS, CORS) —
      // see Login.tsx's identical reasoning for why this can never be
      // worded as a credentials/validation problem.
      setErrorKind('network');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="signup-name" className="text-sm text-muted-foreground">
          {t('signup.name')}
        </label>
        <Input
          id="signup-name"
          required
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm text-muted-foreground">
          {t('signup.email')}
        </label>
        <Input
          id="signup-email"
          type="email"
          required
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-password" className="text-sm text-muted-foreground">
          {t('signup.password')}
        </label>
        <PasswordInput
          id="signup-password"
          required
          minLength={8}
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
        />
      </div>
      {errorKind === 'network' && <p className="text-sm text-destructive">{t('signup.networkError')}</p>}
      {errorKind === 'rateLimit' && <p className="text-sm text-destructive">{t('signup.rateLimitError')}</p>}
      {errorKind === 'invalidEmail' && <p className="text-sm text-destructive">{t('signup.invalidEmailError')}</p>}
      {errorKind === 'passwordTooShort' && <p className="text-sm text-destructive">{t('signup.passwordTooShortError')}</p>}
      {errorKind === 'generic' && <p className="text-sm text-destructive">{t('signup.error')}</p>}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitLabel ?? t('signup.submit')}
      </Button>
    </form>
  );
}
