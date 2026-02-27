import { useEffect, useRef } from 'react';
import {
  Cpu,
  Settings,
  Terminal,
  FolderOpen,
  Globe,
  MessageSquare,
  Info,
  LogOut,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/stores/windowStore';
import { useSound } from '@/hooks/useSound';
import { Separator } from '@/components/ui';
import { Z_INDEX, TASKBAR_HEIGHT } from '@/lib/constants';
import type { WindowType } from '@/types';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  windowType?: WindowType;
  action?: () => void;
}

export function StartMenu({ isOpen, onClose, onLogout }: StartMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { play } = useSound();
  const { openWindow } = useWindowStore();

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const handleItemClick = (item: MenuItem) => {
    play('click');
    if (item.windowType) {
      play('open');
      openWindow(item.windowType);
    } else if (item.action) {
      item.action();
    }
    onClose();
  };

  const menuItems: MenuItem[] = [
    { id: 'computer', label: 'My Computer', icon: <Cpu className="w-4 h-4" />, windowType: 'computer' },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-4 h-4" />, windowType: 'terminal' },
    { id: 'browser', label: 'Browser', icon: <Globe className="w-4 h-4" />, windowType: 'browser' },
    { id: 'files', label: 'Files', icon: <FolderOpen className="w-4 h-4" />, windowType: 'files' },
    { id: 'editor', label: 'Editor', icon: <FileCode className="w-4 h-4" />, windowType: 'editor' },
    { id: 'chat', label: 'Construct Agent', icon: <MessageSquare className="w-4 h-4" />, windowType: 'chat' },
  ];

  const bottomItems: MenuItem[] = [
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, windowType: 'settings' },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" />, windowType: 'about' },
  ];

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        `absolute left-1 w-56
         bg-[var(--color-surface)] border border-[var(--color-border)]
         shadow-[var(--shadow-menu)] rounded-lg overflow-hidden`
      )}
      style={{
        bottom: TASKBAR_HEIGHT + 4,
        zIndex: Z_INDEX.startMenu,
      }}
    >
      {/* Header */}
      <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-accent)]/90">
        <div className="flex items-center gap-2.5 text-white">
          <div className="w-8 h-8 bg-white/20 rounded-md flex items-center justify-center text-sm font-bold">
            C
          </div>
          <div>
            <div className="text-sm font-medium">construct.computer</div>
            <div className="text-xs opacity-80">AI Agent Platform</div>
          </div>
        </div>
      </div>

      {/* Main menu items */}
      <div className="py-1.5 px-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md
                       hover:bg-[var(--color-accent-muted)] 
                       transition-all duration-150 text-left"
            onClick={() => handleItemClick(item)}
          >
            <span className="text-[var(--color-text-muted)]">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <Separator />

      {/* Bottom items */}
      <div className="py-1.5 px-1">
        {bottomItems.map((item) => (
          <button
            key={item.id}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md
                       hover:bg-[var(--color-accent-muted)]
                       transition-all duration-150 text-left"
            onClick={() => handleItemClick(item)}
          >
            <span className="text-[var(--color-text-muted)]">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
        
        {onLogout && (
          <button
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md
                       hover:bg-[var(--color-error-muted)]
                       transition-all duration-150 text-left text-[var(--color-error)]"
            onClick={() => {
              play('click');
              onLogout();
              onClose();
            }}
          >
            <LogOut className="w-4 h-4" />
            <span>Log Out</span>
          </button>
        )}
      </div>
    </div>
  );
}
