import { RefreshCw, ArrowLeft, ArrowRight, Globe, X } from 'lucide-react';
import { useComputerStore, type BrowserTab } from '@/stores/agentStore';
import type { WindowConfig } from '@/types';

interface BrowserWindowProps {
  config: WindowConfig;
}

function TabItem({ tab, onSwitch, onClose }: { 
  tab: BrowserTab; 
  onSwitch: () => void; 
  onClose: (e: React.MouseEvent) => void;
}) {
  // Extract domain from URL for display
  const displayTitle = tab.title || (() => {
    try {
      return new URL(tab.url).hostname || 'New Tab';
    } catch {
      return 'New Tab';
    }
  })();

  return (
    <div
      className={`
        group flex items-center gap-1 px-2 py-1 text-xs cursor-pointer
        border-r border-[var(--color-border)] max-w-[180px] min-w-[80px]
        ${tab.active 
          ? 'bg-[var(--color-surface)] text-[var(--color-text)]' 
          : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
        }
      `}
      onClick={onSwitch}
      title={tab.url}
    >
      <Globe className="w-3 h-3 shrink-0 opacity-50" />
      <span className="truncate flex-1">{displayTitle}</span>
      <button
        className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-border)]"
        onClick={onClose}
        title="Close tab"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function BrowserWindow({ config: _config }: BrowserWindowProps) {
  const computer = useComputerStore((s) => s.computer);
  const browserState = useComputerStore((s) => s.browserState);
  const switchTab = useComputerStore((s) => s.switchTab);
  const closeTab = useComputerStore((s) => s.closeTab);

  const isRunning = computer && computer.status === 'running';

  const url = browserState.url || 'about:blank';
  const pageTitle = browserState.title || '';
  const isLoading = browserState.isLoading;
  const connected = browserState.connected;
  const screenshot = browserState.screenshot;
  const tabs = browserState.tabs;

  // Show the frame - screenshot is a base64 string from the store
  const frameSrc = screenshot ? `data:image/jpeg;base64,${screenshot}` : null;

  const handleSwitchTab = (tabId: string) => {
    switchTab(tabId);
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation(); // Prevent switching to the tab
    closeTab(tabId);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
      {/* Tab bar */}
      {tabs.length > 0 && (
        <div className="shrink-0 flex items-stretch overflow-x-auto bg-[var(--color-surface-raised)] border-b border-[var(--color-border)]">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              onSwitch={() => handleSwitchTab(tab.id)}
              onClose={(e) => handleCloseTab(e, tab.id)}
            />
          ))}
        </div>
      )}

      {/* Navigation bar */}
      <div className="shrink-0 flex items-center gap-1 p-1 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <button
          className="p-1 rounded-md hover:bg-[var(--color-surface)] disabled:opacity-50"
          disabled
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          className="p-1 rounded-md hover:bg-[var(--color-surface)] disabled:opacity-50"
          disabled
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          className={`p-1 rounded-md hover:bg-[var(--color-surface)] ${isLoading ? 'animate-spin' : ''}`}
          disabled
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 px-2 py-1 text-xs font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md">
          <Globe className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />
          <span className="truncate text-[var(--color-text-muted)]">{url}</span>
        </div>
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0 overflow-hidden bg-black relative flex items-center justify-center">
        {frameSrc ? (
          <img
            src={frameSrc}
            alt="Browser"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-center text-[var(--color-text-muted)]">
            {isRunning ? (
              <>
                <Globe className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Waiting for browser activity...</p>
                <p className="text-xs mt-1 opacity-50">
                  Screenshots will appear here when browsing
                </p>
              </>
            ) : (
              <>
                <Globe className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Not connected</p>
                <p className="text-xs mt-1 opacity-50">
                  Start your computer to see browser activity
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 text-xs border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
        <span className="truncate">{isLoading ? 'Loading...' : pageTitle || 'Ready'}</span>
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </div>
  );
}
