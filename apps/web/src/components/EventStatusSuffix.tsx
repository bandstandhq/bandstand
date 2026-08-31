// SPDX-License-Identifier: Apache-2.0
//
// A cancelled or tentative event's status, greyed out right after its
// title — the one shared rendering for what used to be an inline label in
// the calendar list, a badge on the detail page, and nothing at all in the
// month grid and dashboard, three different treatments for the same fact.
import type { EventStatus } from '@bandstand/core';
import { useTranslation } from 'react-i18next';

const STATUS_LABEL_KEY: Partial<Record<EventStatus, string>> = {
  cancelled: 'calendarList.cancelledLabel',
  tentative: 'calendarList.tentativeLabel',
};

export function EventStatusSuffix({ status }: { status: EventStatus }) {
  const { t } = useTranslation();
  const key = STATUS_LABEL_KEY[status];
  if (!key) return null;
  return <span className="ml-2 text-muted-foreground">{t(key)}</span>;
}
