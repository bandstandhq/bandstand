// SPDX-License-Identifier: Apache-2.0
import { ConfirmDialogProvider } from '@bandstand/ui';
import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { GlobalPrefsEffects } from './GlobalPrefsEffects';
import { ScrollToTop } from './ScrollToTop';

export default function RootLayout() {
  const { t } = useTranslation();

  return (
    <ConfirmDialogProvider closeLabel={t('common.close')}>
      <GlobalPrefsEffects />
      <ScrollToTop />
      <Outlet />
    </ConfirmDialogProvider>
  );
}
