import { type ReactNode, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/constants';

interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export function DropdownMenu({ trigger, children, align = 'start', className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const alignClass = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  };

  return (
    <div className="relative inline-block">
      <div ref={triggerRef} onClick={() => setOpen(!open)}>
        {trigger}
      </div>
      {open && (
        <div
          ref={menuRef}
          className={cn(
            `absolute top-full mt-1 min-w-[150px] rounded-lg
             bg-[var(--color-surface)] border border-[var(--color-border)]
             shadow-[var(--shadow-menu)] py-1 overflow-hidden`,
            alignClass[align],
            className
          )}
          style={{ zIndex: Z_INDEX.menu }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
}

export function DropdownMenuItem({
  children,
  onClick,
  disabled,
  destructive,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      className={cn(
        `w-full px-3 py-1.5 text-left text-sm
         hover:bg-[var(--color-accent)] hover:text-white
         disabled:opacity-50 disabled:pointer-events-none
         flex items-center gap-2`,
        destructive && 'text-[var(--color-error)] hover:bg-[var(--color-error)]',
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="h-px bg-[var(--color-border)] my-1" />;
}

interface DropdownMenuLabelProps {
  children: ReactNode;
  className?: string;
}

export function DropdownMenuLabel({ children, className }: DropdownMenuLabelProps) {
  return (
    <div
      className={cn(
        'px-3 py-1 text-xs font-medium text-[var(--color-text-muted)]',
        className
      )}
    >
      {children}
    </div>
  );
}
