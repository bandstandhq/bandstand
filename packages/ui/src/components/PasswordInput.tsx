// SPDX-License-Identifier: Apache-2.0
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { Input } from './Input';

/**
 * A password field with a show/hide toggle. Hidden by default; the shown/
 * hidden state is local to this one field instance and never persisted or
 * shared with any other field. The toggle is excluded from the tab order
 * (`tabIndex={-1}`) so tabbing through the form goes straight from the
 * field to the submit button, not through the icon in between.
 *
 * `showLabel`/`hideLabel` are required rather than defaulting to an
 * English string here: packages/ui has no i18n context of its own.
 *
 * Forwards its ref to the underlying `<input>` — needed for shadcn's
 * `FormControl` (a Radix `Slot`), which composes a ref onto its child.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { showLabel: string; hideLabel: string }
>(function PasswordInput({ className, showLabel, hideLabel, ...props }, ref) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={visible}
        aria-label={visible ? hideLabel : showLabel}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Eye className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
