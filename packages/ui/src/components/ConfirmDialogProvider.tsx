// SPDX-License-Identifier: Apache-2.0
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogAction } from './ConfirmDialog';

interface PendingRequest {
  title: string;
  description?: string;
  actions: ConfirmDialogAction[];
  cancelLabel?: string;
  onDismiss: () => void;
}

type Requester = (request: Omit<PendingRequest, 'onDismiss'> & { onDismiss?: () => void }) => void;

const ConfirmDialogContext = createContext<Requester | null>(null);

/**
 * Mounted once, near the app root — see main.tsx. `closeLabel` is asked for
 * here, once, rather than on every individual call below: it's always the
 * same generic "Close" affordance for the X button, and repeating it at
 * every `confirm()`/`chooseAction()`/`notify()` call site would just be
 * noise (packages/ui has no i18n context of its own to default it to).
 */
export function ConfirmDialogProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);

  const request = useCallback<Requester>((req) => {
    setPending({ onDismiss: () => {}, ...req });
  }, []);

  return (
    <ConfirmDialogContext.Provider value={request}>
      {children}
      {pending && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              pending.onDismiss();
              setPending(null);
            }
          }}
          title={pending.title}
          description={pending.description}
          actions={pending.actions.map((action) => ({
            ...action,
            onClick: () => {
              action.onClick();
              setPending(null);
            },
          }))}
          cancelLabel={pending.cancelLabel}
          closeLabel={closeLabel}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

function useRequestConfirmDialog(): Requester {
  const request = useContext(ConfirmDialogContext);
  if (!request) throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
  return request;
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'default' | 'destructive';
}

export interface ChoiceAction<T> {
  label: string;
  value: T;
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
}

export interface ChoiceOptions<T> {
  title: string;
  description?: string;
  actions: ChoiceAction<T>[];
  cancelLabel: string;
}

export interface NotifyOptions {
  title: string;
  description?: string;
  okLabel: string;
}

/**
 * The imperative replacement for `window.confirm`/`window.alert` — see
 * ConfirmDialog.tsx's own comment. Three shapes on top of the one
 * underlying dialog:
 * - `confirm`: a plain yes/no, same call shape as `window.confirm` (resolves
 *   `true`/`false`).
 * - `chooseAction`: a real choice between several outcomes, e.g. "delete
 *   this occurrence" vs. "delete the whole series" (resolves the chosen
 *   action's `value`, or `null` if cancelled/dismissed).
 * - `notify`: a pure acknowledgement with nothing to cancel, `window.alert`'s
 *   replacement (resolves once dismissed).
 */
export function useConfirmDialog() {
  const request = useRequestConfirmDialog();

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        request({
          title: options.title,
          description: options.description,
          cancelLabel: options.cancelLabel,
          onDismiss: () => resolve(false),
          actions: [
            {
              label: options.confirmLabel,
              variant: options.variant ?? 'destructive',
              onClick: () => resolve(true),
            },
          ],
        });
      }),
    [request],
  );

  const chooseAction = useCallback(
    <T,>(options: ChoiceOptions<T>): Promise<T | null> =>
      new Promise((resolve) => {
        request({
          title: options.title,
          description: options.description,
          cancelLabel: options.cancelLabel,
          onDismiss: () => resolve(null),
          actions: options.actions.map((action) => ({
            label: action.label,
            variant: action.variant,
            onClick: () => resolve(action.value),
          })),
        });
      }),
    [request],
  );

  const notify = useCallback(
    (options: NotifyOptions): Promise<void> =>
      new Promise((resolve) => {
        request({
          title: options.title,
          description: options.description,
          onDismiss: () => resolve(),
          actions: [{ label: options.okLabel, variant: 'default', onClick: () => resolve() }],
        });
      }),
    [request],
  );

  return { confirm, chooseAction, notify };
}
