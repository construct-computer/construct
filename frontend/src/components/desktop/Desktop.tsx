import { useEffect, useRef } from 'react';
import { Wallpaper } from './Wallpaper';
import { MenuBar } from './MenuBar';
import { Dock } from './Dock';
import { WindowManager } from '@/components/window';
import { useWindowStore } from '@/stores/windowStore';
import { useComputerStore } from '@/stores/agentStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { MENUBAR_HEIGHT, DOCK_HEIGHT } from '@/lib/constants';

interface DesktopProps {
  onLogout?: () => void;
  onLockScreen?: () => void;
  onRestart?: () => void;
  isConnected?: boolean;
}

export function Desktop({ onLogout, onLockScreen, onRestart, isConnected }: DesktopProps) {
  const { openWindow, windows } = useWindowStore();
  const hasApiKey = useComputerStore((s) => s.hasApiKey);
  const configChecked = useComputerStore((s) => s.configChecked);
  const setupShownRef = useRef(false);

  // Auto-open setup wizard if API key is not configured
  useEffect(() => {
    if (configChecked && !hasApiKey && !setupShownRef.current) {
      const hasSetupWindow = windows.some((w) => w.type === 'setup');
      if (!hasSetupWindow) {
        setupShownRef.current = true;
        const width = 480;
        const height = 520;
        const x = Math.max(0, (window.innerWidth - width) / 2);
        const y = Math.max(MENUBAR_HEIGHT, (window.innerHeight - DOCK_HEIGHT - height) / 2);
        openWindow('setup', {
          title: 'Welcome to construct.computer',
          x,
          y,
          width,
          height,
        });
      }
    }
    if (hasApiKey) {
      setupShownRef.current = false;
    }
  }, [configChecked, hasApiKey, windows, openWindow]);

  // Handle keyboard shortcuts
  useKeyboardShortcuts({
    onOpenTerminal: () => openWindow('terminal'),
    onToggleStartMenu: () => {
      // No start menu in macOS mode
    },
  });

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Wallpaper */}
      <Wallpaper />

      {/* Menu bar (top) */}
      <MenuBar onLogout={onLogout} onLockScreen={onLockScreen} onRestart={onRestart} isConnected={isConnected} />

      {/* Window area - from menu bar to screen edge (windows can go behind dock) */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{ top: MENUBAR_HEIGHT }}
      >
        <WindowManager />
      </div>

      {/* Dock (bottom) */}
      <Dock />
    </div>
  );
}
