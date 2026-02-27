import { useState } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWindowStore } from '@/stores/windowStore';
import { useSound } from '@/hooks/useSound';
import { StartMenu } from './StartMenu';
import { SystemTray } from './SystemTray';
import { Button } from '@/components/ui';
import { Z_INDEX, TASKBAR_HEIGHT } from '@/lib/constants';

interface TaskbarProps {
  onLogout?: () => void;
  isConnected?: boolean;
}

export function Taskbar({ onLogout, isConnected }: TaskbarProps) {
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const { play } = useSound();
  const { windows, focusedWindowId, focusWindow, minimizeWindow } = useWindowStore();

  const handleStartClick = () => {
    play('click');
    setStartMenuOpen(!startMenuOpen);
  };

  const handleWindowClick = (windowId: string) => {
    play('click');
    const window = windows.find((w) => w.id === windowId);
    if (!window) return;

    if (window.state === 'minimized') {
      // Restore and focus
      focusWindow(windowId);
    } else if (focusedWindowId === windowId) {
      // Minimize if already focused
      minimizeWindow(windowId);
    } else {
      // Focus
      focusWindow(windowId);
    }
  };

  return (
    <>
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center
                   bg-[var(--color-taskbar)] border-t border-[var(--color-border)]
                   backdrop-blur-sm"
        style={{
          height: TASKBAR_HEIGHT,
          zIndex: Z_INDEX.taskbar,
        }}
      >
        {/* Start button */}
        <Button
          variant={startMenuOpen ? 'primary' : 'ghost'}
          size="sm"
          className={cn(
            'h-full px-4 rounded-none border-r border-[var(--color-border)]',
            startMenuOpen && 'bg-[var(--color-accent)] text-white'
          )}
          onClick={handleStartClick}
        >
          <Menu className="w-4 h-4 mr-2" />
          <span className="text-xs font-medium">Start</span>
        </Button>

        {/* Window buttons */}
        <div className="flex-1 flex items-center gap-1 px-2 overflow-x-auto">
          {windows.map((window) => {
            const isFocused = focusedWindowId === window.id;
            const isMinimized = window.state === 'minimized';

            return (
              <button
                key={window.id}
                className={cn(
                  `flex items-center gap-2 px-3 py-1.5 text-xs
                   min-w-[120px] max-w-[200px] h-8
                   border rounded-md transition-all duration-150 truncate`,
                  isFocused
                    ? 'bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-[var(--color-surface)]/60',
                  isMinimized && 'opacity-50'
                )}
                onClick={() => handleWindowClick(window.id)}
                title={window.title}
              >
                {/* Window type indicator */}
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    window.type === 'browser' && 'bg-blue-400',
                    window.type === 'terminal' && 'bg-green-400',
                    window.type === 'files' && 'bg-yellow-400',
                    window.type === 'editor' && 'bg-violet-400',
                    window.type === 'chat' && 'bg-cyan-400',
                    window.type === 'settings' && 'bg-neutral-400',
                    window.type === 'computer' && 'bg-orange-400',
                    window.type === 'about' && 'bg-teal-400'
                  )}
                />
                <span className="truncate">{window.title}</span>
              </button>
            );
          })}
        </div>

        {/* System tray */}
        <SystemTray isConnected={isConnected} />
      </div>

      {/* Start menu */}
      <StartMenu
        isOpen={startMenuOpen}
        onClose={() => setStartMenuOpen(false)}
        onLogout={onLogout}
      />
    </>
  );
}
