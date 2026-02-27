import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          `flex h-8 w-full px-3 py-1.5
           bg-[var(--color-surface)] text-[var(--color-text)]
           border border-[var(--color-border)]
           rounded-[var(--radius-input)]
           text-sm
           shadow-inner shadow-black/[0.02]
           placeholder:text-[var(--color-text-subtle)]
           focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 focus:border-[var(--color-accent)]
           disabled:cursor-not-allowed disabled:opacity-50
           transition-all duration-150`,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
