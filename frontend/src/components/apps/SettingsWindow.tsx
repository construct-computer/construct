import { useEffect } from 'react';
import {
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Cpu,
  Loader2,
  Check,
  Image,
  Cloud,
  Unplug,
  Play,
  Square,
  RefreshCw,
  HardDrive,
  Wifi,
  WifiOff,
  Monitor,
  Terminal,
  MessageSquare,
  Wand2,
} from 'lucide-react';
import { Button, Label, Checkbox, Separator } from '@/components/ui';
import { useSettingsStore, WALLPAPERS, getWallpaperSrc } from '@/stores/settingsStore';
import { useComputerStore } from '@/stores/agentStore';
import { useWindowStore } from '@/stores/windowStore';
import { useDriveSync } from '@/hooks/useDriveSync';
import { useSound } from '@/hooks/useSound';
import { MENUBAR_HEIGHT, DOCK_HEIGHT } from '@/lib/constants';
import type { WindowConfig } from '@/types';

interface SettingsWindowProps {
  config: WindowConfig;
}

export function SettingsWindow({ config: _config }: SettingsWindowProps) {
  const { play } = useSound();
  const { openWindow } = useWindowStore();
  const { theme, soundEnabled, wallpaperId, toggleTheme, toggleSound, setWallpaper } =
    useSettingsStore();
  
  const {
    computer,
    isLoading,
    error,
    hasApiKey,
    hasTinyfishKey,
    hasAgentmailKey,
    configChecked,
    fetchComputer,
    startComputer,
    stopComputer,
    subscribeToComputer,
  } = useComputerStore();
  const instanceId = useComputerStore((s) => s.instanceId);
  const driveSync = useDriveSync(instanceId);

  // Subscribe to computer events when running
  useEffect(() => {
    if (computer?.status === 'running') {
      subscribeToComputer();
    }
  }, [computer?.status, subscribeToComputer]);

  const handleOpenWizard = () => {
    play('open');
    const width = 560;
    const height = 640;
    const x = Math.max(0, (window.innerWidth - width) / 2);
    const y = Math.max(MENUBAR_HEIGHT, (window.innerHeight - DOCK_HEIGHT - height) / 2);
    openWindow('setup', { title: 'Welcome to construct.computer', x, y, width, height });
  };

  const handleStart = async () => {
    play('click');
    const success = await startComputer();
    if (success) {
      play('open');
    } else {
      play('error');
    }
  };

  const handleStop = async () => {
    play('click');
    const success = await stopComputer();
    if (success) {
      play('close');
    } else {
      play('error');
    }
  };

  const handleOpenBrowser = () => {
    if (!computer) return;
    play('open');
    openWindow('browser', { agentId: computer.id, title: 'Browser' });
  };

  const handleOpenTerminal = () => {
    if (!computer) return;
    play('open');
    openWindow('terminal', { agentId: computer.id, title: 'Terminal' });
  };

  const handleOpenChat = () => {
    if (!computer) return;
    play('open');
    openWindow('chat', { agentId: computer.id, title: 'Construct Agent' });
  };

  const isRunning = computer?.status === 'running';
  const isStarting = computer?.status === 'starting';
  const isStopping = computer?.status === 'stopping';
  const hasError = computer?.status === 'error';

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-auto">
      <div className="p-4 space-y-4">
        {/* Computer Status Section */}
        <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-raised)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[var(--color-text-muted)] flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              My Computer
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                play('click');
                fetchComputer();
              }}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-2 text-sm rounded-lg bg-[var(--color-error-muted)] text-[var(--color-error)] mb-3">
              {error}
            </div>
          )}

          {isLoading && !computer ? (
            <div className="flex items-center justify-center py-6 text-[var(--color-text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : computer ? (
            <div className="space-y-3">
              {/* Status card */}
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-sm">{computer.name}</h4>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {computer.description || 'Your personal AI computer'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isRunning ? (
                    <Wifi className="w-4 h-4 text-[var(--color-success)]" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-[var(--color-text-muted)]" />
                  )}
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      isRunning
                        ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                        : isStarting || isStopping
                        ? 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]'
                        : hasError
                        ? 'bg-[var(--color-error-muted)] text-[var(--color-error)]'
                        : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {computer.status}
                  </span>
                </div>
              </div>

              {/* Agent info */}
              {computer.config && (
                <div className="pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-4">
                    <span>Agent: {computer.config.identityName || 'BoneClaw'}</span>
                    <span>Model: {computer.config.model}</span>
                  </div>
                </div>
              )}

              {/* Power controls */}
              <div className="flex gap-2">
                {isRunning ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStop}
                    disabled={isStopping}
                  >
                    {isStopping ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4 mr-1" />
                    )}
                    {isStopping ? 'Stopping...' : 'Stop'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleStart}
                    disabled={isStarting}
                  >
                    {isStarting ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-1" />
                    )}
                    {isStarting ? 'Starting...' : 'Start'}
                  </Button>
                )}
              </div>

              {/* Quick actions (only when running) */}
              {isRunning && (
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Quick Actions</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-col h-auto py-3"
                      onClick={handleOpenBrowser}
                    >
                      <Monitor className="w-5 h-5 mb-1" />
                      <span className="text-xs">Browser</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-col h-auto py-3"
                      onClick={handleOpenTerminal}
                    >
                      <Terminal className="w-5 h-5 mb-1" />
                      <span className="text-xs">Terminal</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-col h-auto py-3"
                      onClick={handleOpenChat}
                    >
                      <MessageSquare className="w-5 h-5 mb-1" />
                      <span className="text-xs">Agent</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Resources */}
              <div className="pt-3 border-t border-[var(--color-border)]">
                <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>20 GB</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>1 GB RAM</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6 text-[var(--color-text-muted)]">
              <p className="text-sm">Failed to load computer. Try refreshing.</p>
            </div>
          )}
        </div>

        {/* AI Configuration */}
        <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-raised)]">
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            AI Configuration
          </h3>

          {/* Status summary */}
          {configChecked && (
            <div className="space-y-1.5 mb-3">
              {[
                { label: 'OpenRouter', configured: hasApiKey, required: true },
                { label: 'TinyFish', configured: hasTinyfishKey },
                { label: 'AgentMail', configured: hasAgentmailKey },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <span>{s.label}</span>
                  <span className={`flex items-center gap-1 ${s.configured ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.configured ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
                    {s.configured ? 'Configured' : s.required ? 'Required' : 'Not set'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {computer?.config?.model && (
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              Model: {computer.config.model}
            </p>
          )}

          <Button
            size="sm"
            variant="primary"
            onClick={handleOpenWizard}
            className="w-full"
          >
            <Wand2 className="w-4 h-4 mr-1.5" />
            Configure Services...
          </Button>
        </div>
        
        {/* Google Drive */}
        {driveSync.isConfigured && (
          <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-raised)]">
            <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              Google Drive
            </h3>
            {driveSync.status.connected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <p className="text-xs font-medium">Connected</p>
                    </div>
                    {driveSync.status.email && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{driveSync.status.email}</p>
                    )}
                    {driveSync.status.lastSync && (
                      <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                        Last sync: {new Date(driveSync.status.lastSync).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={driveSync.sync}
                    disabled={driveSync.isSyncing}
                    className="flex-1"
                  >
                    {driveSync.isSyncing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      'Sync Now'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={driveSync.disconnect}
                  >
                    <Unplug className="w-4 h-4" />
                  </Button>
                </div>
                {driveSync.lastReport && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {driveSync.lastReport.downloaded.length} downloaded, {driveSync.lastReport.uploaded.length} uploaded
                    {driveSync.lastReport.conflicts.length > 0 && `, ${driveSync.lastReport.conflicts.length} conflicts`}
                  </p>
                )}
                {driveSync.error && (
                  <p className="text-xs text-red-400">{driveSync.error}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Connect your Google Drive to sync files between your workspace and the cloud.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={driveSync.connect}
                  className="w-full"
                >
                  Connect Google Drive
                </Button>
                {driveSync.error && (
                  <p className="text-xs text-red-400">{driveSync.error}</p>
                )}
              </div>
            )}
          </div>
        )}
        
        <Separator />
      
          {/* Appearance */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {theme === 'dark' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
              <Label>Theme</Label>
            </div>
            <Button variant="default" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
          </div>

          {/* Wallpaper picker */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Image className="w-4 h-4" />
              <Label>Wallpaper</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WALLPAPERS.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => setWallpaper(wp.id)}
                  className="relative rounded-lg overflow-hidden border-2 transition-all duration-150 focus:outline-none"
                  style={{
                    borderColor: wallpaperId === wp.id ? 'var(--color-accent)' : 'var(--color-border)',
                    boxShadow: wallpaperId === wp.id ? '0 0 0 1px var(--color-accent)' : 'none',
                  }}
                >
                  <div
                    className="w-full aspect-video"
                    style={{
                      backgroundImage: `url(${getWallpaperSrc(wp.id)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] font-medium truncate"
                    style={{
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    {wp.name}
                  </div>
                  {wallpaperId === wp.id && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* Sound & Window Management */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
              <Label>UI Sounds</Label>
            </div>
            <Checkbox
              checked={soundEnabled}
              onCheckedChange={toggleSound}
            />
          </div>
          
        </div>
        
        <Separator />
        
        {/* Keyboard Shortcuts */}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">
            Keyboard Shortcuts
          </h3>
          <div className="text-xs space-y-1 text-[var(--color-text-muted)]">
            <div className="flex justify-between">
              <span>Close window</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+F4
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Minimize</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+M
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Maximize</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+Enter
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Cycle windows</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+Tab
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
