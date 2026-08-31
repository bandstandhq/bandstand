// SPDX-License-Identifier: Apache-2.0
//
// Shared three-way prompt for useUnsavedChangesGuard — Save, Discard, or
// Continue editing, rather than the plain yes/no window.confirm elsewhere
// in the app (see packages/ui's Dialog for why this is a real dialog and
// not that).
import { Button, Dialog } from '@bandstand/ui';
import { useTranslation } from 'react-i18next';

export function UnsavedChangesDialog({
  open,
  onSave,
  onDiscard,
  onContinueEditing,
}: {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onContinueEditing: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onContinueEditing();
      }}
      title={t('unsavedChanges.title')}
      description={t('unsavedChanges.description')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onContinueEditing}>
          {t('unsavedChanges.continueEditing')}
        </Button>
        <Button type="button" variant="destructive" onClick={onDiscard}>
          {t('unsavedChanges.discard')}
        </Button>
        <Button type="button" onClick={onSave}>
          {t('unsavedChanges.save')}
        </Button>
      </div>
    </Dialog>
  );
}
