import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useSound } from '@/hooks/useSound';

interface DesktopIconProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  onDoubleClick: () => void;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export function DesktopIcon({
  id,
  label,
  icon,
  onDoubleClick,
  selected,
  onSelect,
}: DesktopIconProps) {
  const { play } = useSound();
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    play('click');
    onSelect?.(id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    play('open');
    onDoubleClick();
  };

  return (
    <div
      className={cn(
        `flex flex-col items-center justify-center p-2 cursor-pointer
         select-none transition-all duration-150 w-20 rounded-lg`,
        selected && 'bg-[var(--color-surface)]/80 shadow-sm',
        isHovered && !selected && 'bg-[var(--color-surface)]/50'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon container with soft background */}
      <div
        className={cn(
          `w-12 h-12 flex items-center justify-center rounded-lg
           transition-all duration-150`,
          selected 
            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' 
            : 'text-[var(--color-text-muted)]',
          isHovered && !selected && 'text-[var(--color-text)]'
        )}
      >
        {icon}
      </div>
      
      {/* Label with soft styling */}
      <span
        className={cn(
          `mt-1.5 text-[11px] text-center leading-tight max-w-full
           px-1.5 py-0.5 rounded`,
          selected
            ? 'bg-[var(--color-accent)] text-white'
            : 'text-[var(--color-text)]'
        )}
        style={{
          textShadow: selected ? 'none' : '0 1px 2px rgba(255,255,255,0.6)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
