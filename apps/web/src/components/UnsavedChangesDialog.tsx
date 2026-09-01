// SPDX-License-Identifier: Apache-2.0
//
// Shared three-way prompt for useUnsavedChangesGuard — Save, Discard, or
// Continue editing. Predates ConfirmDialog/useConfirmDialog (packages/ui),
// which now covers every plain yes/no and multi-choice confirmation
// elsewhere in the app; this one stays a bespoke Dialog composition since
// its "dismiss" (Escape/overlay) has its own distinct meaning (continue
// editing), not a generic cancel.
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
