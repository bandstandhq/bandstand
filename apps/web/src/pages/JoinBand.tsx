// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { SignupForm } from '../components/SignupForm';
import { apiClient } from '../lib/api-client';
import { authClient } from '../lib/auth-client';
import { joinBandErrorKey } from '../lib/joinBandError';
import { useActiveBandStore } from '../stores/activeBand';

/**
 * One-tap-from-QR join: /join/:code. Logged in -> redeems immediately.
 * Not logged in -> sign up right here (code stays visible/pre-filled in
 * context), then the session update below picks it up and redeems
 * automatically — no separate "now go redeem your code" step.
 */
export function JoinBand() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const { data: session, isPending } = authClient.useSession();
  const setActiveBandId = useActiveBandStore((s) => s.setActiveBandId);
  const [error, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !code) return;
    apiClient
      .redeemInvite({ code })
      .then(({ band }) => {
        setActiveBandId(band.id);
        navigate('/dashboard');
      })
      .catch((err) => setErrorMessage(t(joinBandErrorKey(err instanceof Error ? err.message : String(err)))));
  }, [session, code, navigate, setActiveBandId, t]);

  if (!code) return <Navigate to="/dashboard" replace />;
  if (isPending) return null;

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-destructive">{error}</p>
      </main>
    );
  }

  if (session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">{t('joinBand.redeeming')}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium text-card-foreground">{t('joinBand.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('joinBand.codeLabel', { code })}</p>
        <SignupForm onSuccess={() => {}} submitLabel={t('joinBand.signUpAndJoin')} />
        <p className="text-sm text-muted-foreground">
          {t('signup.haveAccount')}{' '}
          <Link to={`/login?next=/join/${code}`} className="underline">
            {t('joinBand.logInInstead')}
          </Link>
        </p>
      </div>
    </main>
  );
}
