import { forwardRef, type InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, onChange, ...props }, ref) => {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          onChange={(e) => {
            onChange?.(e);
            onCheckedChange?.(e.target.checked);
          }}
          className="sr-only peer"
          {...props}
        />
        <div
          className={cn(
            `h-4 w-4 shrink-0 cursor-pointer rounded
             bg-[var(--color-surface)]
             border border-[var(--color-border-strong)]
             border-t-[var(--color-border-strong)] border-l-[var(--color-border-strong)]
             border-b-[var(--color-surface)] border-r-[var(--color-surface)]
             peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent)]
             peer-disabled:cursor-not-allowed peer-disabled:opacity-50
             flex items-center justify-center`,
            checked && 'bg-[var(--color-accent)] border-[var(--color-accent)]',
            className
          )}
        >
          {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
