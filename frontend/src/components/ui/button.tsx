import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base styles - soft and rounded
  `inline-flex items-center justify-center font-medium transition-all duration-150
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1
   disabled:pointer-events-none disabled:opacity-50
   select-none cursor-pointer rounded-[var(--radius-button)]`,
  {
    variants: {
      variant: {
        default: `
          bg-[var(--color-surface)] text-[var(--color-text)]
          border border-[var(--color-border)]
          shadow-sm
          hover:bg-[var(--color-surface-raised)] hover:border-[var(--color-border-strong)]
          active:shadow-inner active:bg-[var(--color-surface)]
        `,
        primary: `
          bg-[var(--color-accent)] text-white
          border border-[var(--color-accent-hover)]
          shadow-sm
          hover:bg-[var(--color-accent-hover)] hover:shadow
          active:shadow-inner
        `,
        ghost: `
          bg-transparent text-[var(--color-text)]
          hover:bg-[var(--color-surface)]/60
          border border-transparent
        `,
        destructive: `
          bg-[var(--color-error)] text-white
          border border-[var(--color-error)]
          shadow-sm
          hover:opacity-90
        `,
        link: `
          bg-transparent text-[var(--color-accent)]
          underline-offset-4 hover:underline
          border-none
        `,
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-base',
        icon: 'h-8 w-8',
        'icon-sm': 'h-6 w-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
