import { cn } from '@/lib/utils';
import type { WindowState } from '@/types';

interface TitleBarProps {
  title: string;
  icon?: string;
  isFocused: boolean;
  state: WindowState;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onDoubleClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

export function TitleBar({
  title,
  icon,
  isFocused,
  state,
  onMinimize,
  onMaximize,
  onClose,
  onDoubleClick,
  onMouseDown,
}: TitleBarProps) {
  return (
    <div
      className="flex items-center h-8 px-2.5 select-none shrink-0"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Window control dots - Mac style, on the left */}
      <div className="flex items-center gap-1.5 mr-3 group">
        {/* Close */}
        <button
          className={cn(
            'w-3.5 h-3.5 rounded-full transition-all',
            isFocused
              ? 'bg-[var(--color-dot-close)] hover:brightness-90'
              : 'bg-black/10 dark:bg-white/20'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
        />
        
        {/* Minimize */}
        <button
          className={cn(
            'w-3.5 h-3.5 rounded-full transition-all',
            isFocused
              ? 'bg-[var(--color-dot-minimize)] hover:brightness-90'
              : 'bg-black/10 dark:bg-white/20'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onMinimize();
          }}
          title="Minimize"
        />
        
        {/* Maximize */}
        <button
          className={cn(
            'w-3.5 h-3.5 rounded-full transition-all',
            isFocused
              ? 'bg-[var(--color-dot-maximize)] hover:brightness-90'
              : 'bg-black/10 dark:bg-white/20'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onMaximize();
          }}
          title={state === 'maximized' ? 'Restore' : 'Maximize'}
        />
      </div>
      
      {/* Icon */}
      {icon && (
        <img src={icon} alt="" className="w-4 h-4 mr-1.5" />
      )}
      
      {/* Title - centered */}
      <span
        className={cn(
          'flex-1 text-sm font-bold truncate text-center select-none',
          isFocused
            ? 'text-black/90 dark:text-white'
            : 'text-black/40 dark:text-white/50'
        )}
      >
        {title}
      </span>
      
      {/* Spacer to balance the dots on the left */}
      <div className="w-[58px]" />
    </div>
  );
}
