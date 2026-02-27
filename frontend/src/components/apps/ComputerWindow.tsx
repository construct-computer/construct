import { useEffect } from 'react';
import {
  Play,
  Square,
  Settings,
  MessageSquare,
  Monitor,
  Terminal,
  Loader2,
  RefreshCw,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { useWindowStore } from '@/stores/windowStore';
import { useComputerStore } from '@/stores/agentStore';
import { useSound } from '@/hooks/useSound';
import type { WindowConfig } from '@/types';

interface ComputerWindowProps {
  config: WindowConfig;
}

export function ComputerWindow({ config: _config }: ComputerWindowProps) {
  const { play } = useSound();
  const { openWindow } = useWindowStore();
  const {
    computer,
    isLoading,
    error,
    fetchComputer,
    startComputer,
    stopComputer,
    subscribeToComputer,
  } = useComputerStore();

  // No need to fetch on mount — App.tsx already provisions the computer
  // before the Desktop (and this window) can render.

  // Subscribe to computer events when running
  useEffect(() => {
    if (computer?.status === 'running') {
      subscribeToComputer();
    }
  }, [computer?.status, subscribeToComputer]);

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

  const handleOpenSettings = () => {
    play('open');
    openWindow('settings', { title: 'Settings' });
  };

  const isRunning = computer?.status === 'running';
  const isStarting = computer?.status === 'starting';
  const isStopping = computer?.status === 'stopping';
  const hasError = computer?.status === 'error';

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className="text-sm font-medium">My Computer</h2>
        </div>
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
        <div className="p-2 text-sm rounded-lg bg-[var(--color-error-muted)] text-[var(--color-error)] border-b border-[var(--color-error)]">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && !computer ? (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>Loading...</span>
          </div>
        ) : computer ? (
          <div className="space-y-4">
            {/* Computer status card */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{computer.name}</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {computer.description || 'Your personal AI computer'}
                  </p>
                </div>
                
                {/* Status indicator */}
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
                        : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {computer.status}
                  </span>
                </div>
              </div>

              {/* Agent info */}
              {computer.config && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-4">
                    <span>Agent: {computer.config.identityName || 'BoneClaw'}</span>
                    <span>Model: {computer.config.model}</span>
                  </div>
                </div>
              )}

              {/* Power controls */}
              <div className="mt-4 flex gap-2">
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
                <Button size="sm" variant="ghost" onClick={handleOpenSettings}>
                  <Settings className="w-4 h-4 mr-1" />
                  Settings
                </Button>
              </div>
            </div>

            {/* Quick actions (only when running) */}
            {isRunning && (
              <div className="border border-[var(--color-border)] rounded-lg p-4">
                <h4 className="text-sm font-medium mb-3">Quick Actions</h4>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-col h-auto py-3"
                    onClick={handleOpenBrowser}
                  >
                    <Monitor className="w-6 h-6 mb-1" />
                    <span className="text-xs">Browser</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-col h-auto py-3"
                    onClick={handleOpenTerminal}
                  >
                    <Terminal className="w-6 h-6 mb-1" />
                    <span className="text-xs">Terminal</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-col h-auto py-3"
                    onClick={handleOpenChat}
                  >
                    <MessageSquare className="w-6 h-6 mb-1" />
                    <span className="text-xs">Construct Agent</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Resource info */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <h4 className="text-sm font-medium mb-2">Resources</h4>
              <div className="space-y-2 text-xs text-[var(--color-text-muted)]">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  <span>Storage: 10 GB</span>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  <span>Memory: 1 GB RAM</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
            <p className="text-sm">Failed to load computer. Try refreshing.</p>
          </div>
        )}
      </div>
    </div>
  );
}
