import { type ReactNode, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ children, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('overflow-auto', className)}
      >
        {children}
      </div>
    );
  }
);

ScrollArea.displayName = 'ScrollArea';
