import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Volume2, VolumeX, Moon, Sun } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { Tooltip } from '@/components/ui';
import { formatTime, formatDate } from '@/lib/utils';

interface SystemTrayProps {
  isConnected?: boolean;
}

export function SystemTray({ isConnected = true }: SystemTrayProps) {
  const [time, setTime] = useState(new Date());
  const { theme, soundEnabled, toggleTheme, toggleSound } =
    useSettingsStore();

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-0.5 px-2">
      {/* Theme toggle */}
      <Tooltip content={theme === 'dark' ? 'Dark Mode' : 'Light Mode'} side="top">
        <button
          className="p-1.5 rounded-md hover:bg-[var(--color-surface)]/60 transition-all duration-150"
          onClick={toggleTheme}
        >
          {theme === 'dark' ? (
            <Moon className="w-4 h-4 text-[var(--color-text-muted)]" />
          ) : (
            <Sun className="w-4 h-4 text-[var(--color-text-muted)]" />
          )}
        </button>
      </Tooltip>

      {/* Sound toggle */}
      <Tooltip content={soundEnabled ? 'Sound On' : 'Sound Off'} side="top">
        <button
          className="p-1.5 rounded-md hover:bg-[var(--color-surface)]/60 transition-all duration-150"
          onClick={toggleSound}
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4 text-[var(--color-text-muted)]" />
          ) : (
            <VolumeX className="w-4 h-4 text-[var(--color-text-muted)]" />
          )}
        </button>
      </Tooltip>

      {/* Connection status */}
      <Tooltip content={isConnected ? 'Connected' : 'Disconnected'} side="top">
        <div className="p-1.5">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-[var(--color-success)]" />
          ) : (
            <WifiOff className="w-4 h-4 text-[var(--color-error)]" />
          )}
        </div>
      </Tooltip>

      {/* Separator */}
      <div className="w-px h-5 bg-[var(--color-border)] mx-1.5 rounded-full" />

      {/* Clock */}
      <Tooltip content={formatDate(time)} side="top">
        <div className="text-xs text-[var(--color-text)] px-2 py-1">
          {formatTime(time)}
        </div>
      </Tooltip>
    </div>
  );
}
