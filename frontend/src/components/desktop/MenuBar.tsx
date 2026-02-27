import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Wifi, WifiOff, Settings, Sun, Moon, Volume2, VolumeOff } from 'lucide-react';
import { useWindowStore } from '@/stores/windowStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { MENUBAR_HEIGHT, Z_INDEX } from '@/lib/constants';
import { formatTime, formatDate } from '@/lib/utils';

// Assets
import constructLogo from '@/assets/construct-logo.png';

interface MenuBarProps {
  onLogout?: () => void;
  isConnected?: boolean;
}

interface MenuState {
  open: string | null;
}

export function MenuBar({ onLogout, isConnected }: MenuBarProps) {
  const [menu, setMenu] = useState<MenuState>({ open: null });
  const [time, setTime] = useState(new Date());
  const menuRef = useRef<HTMLDivElement>(null);
  const logoButtonRef = useRef<HTMLButtonElement>(null);
  const { theme, soundEnabled, toggleTheme, toggleSound } = useSettingsStore();
  const { windows, focusedWindowId, openWindow } = useWindowStore();

  const focusedWindow = windows.find((w) => w.id === focusedWindowId);
  const activeAppName = focusedWindow?.title || 'Finder';

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // Also check if the click was on the portaled dropdown
        const dropdown = document.getElementById('menu-dropdown-portal');
        if (dropdown && dropdown.contains(e.target as Node)) return;
        setMenu({ open: null });
      }
    };
    if (menu.open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [menu.open]);

  const toggleMenu = (name: string) => {
    setMenu((s) => ({ open: s.open === name ? null : name }));
  };

  const hoverMenu = (name: string) => {
    if (menu.open && menu.open !== name) {
      setMenu({ open: name });
    }
  };

  // Compute dropdown position from the logo button
  const getDropdownPos = () => {
    if (!logoButtonRef.current) return { top: MENUBAR_HEIGHT + 4, left: 6 };
    const rect = logoButtonRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left };
  };

  return (
    <div
      ref={menuRef}
      className="absolute top-0 left-0 right-0 flex items-center select-none
                 bg-white/60 dark:bg-black/5 backdrop-blur-md"
      style={{ height: MENUBAR_HEIGHT, zIndex: Z_INDEX.taskbar }}
    >
      {/* Logo menu */}
      <div className="relative flex items-center ml-1.5">
        <button
          ref={logoButtonRef}
          className={`p-1 flex items-center justify-center rounded-md transition ${
            menu.open === 'apple' ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/5 dark:hover:bg-white/10'
          }`}
          onClick={() => toggleMenu('apple')}
          onMouseEnter={() => hoverMenu('apple')}
        >
          <img
            src={constructLogo}
            alt="construct.computer"
            className="h-4 w-4 object-contain invert dark:invert-0"
            draggable={false}
          />
        </button>
        {menu.open === 'apple' && (
          <MenuDropdownPortal position={getDropdownPos()}>
            <div className="px-3 py-1.5 text-black/35 dark:text-white/40 text-xs font-semibold">
              construct.computer
            </div>
            <MenuDivider />
            <MenuItem label="About" onClick={() => { openWindow('about'); setMenu({ open: null }); }} />
            <MenuDivider />
            <MenuItem label="Settings..." icon={<Settings className="w-3.5 h-3.5" />} onClick={() => { openWindow('settings'); setMenu({ open: null }); }} />
            <MenuDivider />
            <MenuItem
              label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              icon={theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              onClick={() => { toggleTheme(); }}
            />
            <MenuItem
              label={soundEnabled ? 'Mute Sound' : 'Unmute Sound'}
              icon={soundEnabled ? <VolumeOff className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              onClick={() => { toggleSound(); }}
            />
            <MenuDivider />
            <MenuItem
              label="Log Out..."
              className="text-red-500 dark:text-red-400"
              onClick={() => { onLogout?.(); setMenu({ open: null }); }}
            />
          </MenuDropdownPortal>
        )}
      </div>

      {/* Active app name */}
      <span className="px-2 text-sm font-bold text-black/90 dark:text-white ml-1">
        {activeAppName}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side - status icons + clock */}
      <div className="flex items-center gap-1 px-3">
        {/* Connection */}
        <div className="p-1">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-black/70 dark:text-white" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500 dark:text-red-400" />
          )}
        </div>

        {/* Clock */}
        <span className="text-sm text-black/70 dark:text-white px-1.5" title={formatDate(time)}>
          {formatTime(time)}
        </span>
      </div>
    </div>
  );
}

// --- Menu primitives ---

/** Portaled dropdown — rendered at document.body to escape MenuBar's backdrop-filter stacking context */
function MenuDropdownPortal({ children, position }: { children: React.ReactNode; position: { top: number; left: number } }) {
  return createPortal(
    <div
      id="menu-dropdown-portal"
      className="fixed min-w-[220px] py-1.5
                 bg-white/50 dark:bg-black/50 backdrop-blur-2xl saturate-150
                 border border-black/10 dark:border-white/15 rounded-xl
                 shadow-2xl shadow-black/20 dark:shadow-black/40"
      style={{ zIndex: Z_INDEX.menu, top: position.top, left: position.left }}
    >
      {children}
    </div>,
    document.body
  );
}

function MenuItem({ label, icon, shortcut, onClick, disabled, className }: {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition
                  ${disabled ? 'text-black/25 dark:text-white/30 cursor-default' : 'text-black/80 dark:text-white/90 hover:bg-black/5 dark:hover:bg-white/10'}
                  ${className || ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon && (
        <span className="w-4 flex items-center justify-center shrink-0">
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-xs text-black/25 dark:text-white/30 ml-4">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="mx-2 my-1 border-t border-black/10 dark:border-white/10" />;
}
