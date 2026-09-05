// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ServerPicker } from '../components/ServerPicker';
import { SignupForm } from '../components/SignupForm';

export function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <ServerPicker />
      </div>
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('signup.title')}</h1>
        <SignupForm onSuccess={() => navigate('/dashboard')} />
        <p className="text-sm text-muted-foreground">
          {t('signup.haveAccount')}{' '}
          <Link to="/login" className="underline">
            {t('login.submit')}
          </Link>
        </p>
      </div>
    </main>
  );
}
