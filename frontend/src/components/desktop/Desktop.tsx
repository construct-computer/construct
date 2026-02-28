import { useEffect, useRef } from 'react';
import { Wallpaper } from './Wallpaper';
import { MenuBar } from './MenuBar';
import { Dock } from './Dock';
import { SystemStatsWidget } from './SystemStatsWidget';
import { NotificationCenter } from './NotificationCenter';
import { Toasts } from '@/components/ui';
import { WindowManager } from '@/components/window';
import { useWindowStore } from '@/stores/windowStore';
import { useComputerStore } from '@/stores/agentStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDriveStatus } from '@/services/api';
import { MENUBAR_HEIGHT, DOCK_HEIGHT, Z_INDEX } from '@/lib/constants';

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

  // Handle OAuth callback redirect (e.g. ?drive=connected)
  const addNotification = useNotificationStore((s) => s.addNotification);
  const oauthHandledRef = useRef(false);

  useEffect(() => {
    if (oauthHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const driveResult = params.get('drive');
    if (!driveResult) return;

    oauthHandledRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);

    if (driveResult === 'connected') {
      // Fetch status from API to get the email (URL param may be empty)
      getDriveStatus().then((result) => {
        const email = result.success ? result.data.email : undefined;
        addNotification({
          title: 'Google Drive connected',
          body: email ? `Signed in as ${email}` : 'Your Drive is now linked',
          source: 'Google Drive',
          variant: 'success',
        });
      });
    } else if (driveResult === 'denied' || driveResult === 'error') {
      addNotification({
        title: 'Google Drive connection failed',
        body: driveResult === 'denied' ? 'Access was denied' : 'An error occurred',
        source: 'Google Drive',
        variant: 'error',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* Desktop widgets layer — above wallpaper, below windows */}
      <div
        className="absolute right-3 pointer-events-none"
        style={{ top: MENUBAR_HEIGHT + 12, zIndex: Z_INDEX.desktopIcon }}
      >
        <SystemStatsWidget />
      </div>

      {/* Dock (bottom) */}
      <Dock />

      {/* Notification system */}
      <Toasts />
      <NotificationCenter />
    </div>
  );
}
