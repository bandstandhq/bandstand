// SPDX-License-Identifier: Apache-2.0
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
}

/**
 * The styled replacement for `window.confirm`/`window.alert` — see
 * `useConfirmDialog` for the imperative hook most call sites should reach
 * for instead of rendering this directly. `actions` is a list rather than a
 * single confirm callback so the same component covers both a plain
 * yes/no confirmation (one action) and a real choice between several
 * outcomes (e.g. "delete this occurrence" vs. "delete the whole series") —
 * omit `cancelLabel` for a pure acknowledgement (`window.alert`'s
 * replacement) that has nothing to cancel.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  cancelLabel,
  closeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actions: ConfirmDialogAction[];
  cancelLabel?: string;
  closeLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} closeLabel={closeLabel}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {cancelLabel && (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        )}
        {actions.map((action) => (
          <Button key={action.label} type="button" variant={action.variant ?? 'destructive'} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
