// SPDX-License-Identifier: Apache-2.0
import { INVITE_CODE_LENGTH, type Band } from '@bandstand/core';
import { Button, Input } from '@bandstand/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api-client';
import { joinBandErrorKey } from '../lib/joinBandError';

/** An `INVITE_CODE_LENGTH`-character invite code, entered by hand — not a link/QR tap (that's JoinBand.tsx's job). */
export function JoinBandForm({
  initialCode = '',
  onJoined,
}: {
  initialCode?: string;
  onJoined: (band: Band) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(initialCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { band } = await apiClient.redeemInvite({ code });
      onJoined(band);
    } catch (err) {
      // The server returns a stable code (e.g. "unknown_code"), not a
      // sentence, specifically so each case gets its own localized
      // message here instead of displaying server-authored English text.
      setError(t(joinBandErrorKey(err instanceof Error ? err.message : String(err))));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t('joinBand.manualCodePlaceholder')}
        aria-label={t('joinBand.manualCodeLabel')}
        className="w-40 uppercase"
        maxLength={INVITE_CODE_LENGTH}
      />
      <Button type="submit" size="sm" disabled={submitting || !code.trim()}>
        {submitting ? t('joinBand.joining') : t('joinBand.manualSubmit')}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}
