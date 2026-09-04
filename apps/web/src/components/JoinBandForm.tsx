// SPDX-License-Identifier: Apache-2.0
import { zodResolver } from '@hookform/resolvers/zod';
import { INVITE_CODE_LENGTH, type Band } from '@bandstand/core';
import { Button, Form, FormControl, FormField, FormItem, Input } from '@bandstand/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { apiClient } from '../lib/api-client';
import { joinBandErrorKey } from '../lib/joinBandError';

// Deliberately just "non-empty", not @bandstand/core's redeemInviteInputSchema
// (which also enforces the exact code format) — an actually-invalid code
// still needs to go to the server and come back through joinBandErrorKey so
// its specific, localized reason (expired/revoked/redeemed/...) still shows.
const joinBandSchema = z.object({ code: z.string().trim().min(1) });
type JoinBandValues = z.infer<typeof joinBandSchema>;

/** An `INVITE_CODE_LENGTH`-character invite code, entered by hand — not a link/QR tap (that's JoinBand.tsx's job). */
export function JoinBandForm({
  initialCode = '',
  onJoined,
}: {
  initialCode?: string;
  onJoined: (band: Band) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<JoinBandValues>({
    resolver: zodResolver(joinBandSchema),
    defaultValues: { code: initialCode },
  });
  const codeValue = useWatch({ control: form.control, name: 'code' });

  async function onSubmit(values: JoinBandValues) {
    setError(null);
    try {
      const { band } = await apiClient.redeemInvite({ code: values.code });
      onJoined(band);
    } catch (err) {
      // The server returns a stable code (e.g. "unknown_code"), not a
      // sentence, specifically so each case gets its own localized
      // message here instead of displaying server-authored English text.
      setError(t(joinBandErrorKey(err instanceof Error ? err.message : String(err))));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-wrap items-center gap-2">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem className="contents">
              <FormControl>
                <Input
                  placeholder={t('joinBand.manualCodePlaceholder')}
                  aria-label={t('joinBand.manualCodeLabel')}
                  className="w-40 uppercase"
                  maxLength={INVITE_CODE_LENGTH}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting || !codeValue.trim()}>
          {form.formState.isSubmitting ? t('joinBand.joining') : t('joinBand.manualSubmit')}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>
    </Form>
  );
}
