import { useState, useRef, useCallback, useEffect } from 'react';
import { RefreshCw, ArrowLeft, ArrowRight, Globe, X, Monitor, Lock, Unlock } from 'lucide-react';
import { useComputerStore, type BrowserTab } from '@/stores/agentStore';
import { browserWS } from '@/services/websocket';
import type { WindowConfig } from '@/types';

interface BrowserWindowProps {
  config: WindowConfig;
}

/** Check whether a tab represents real browsing (not the default New Tab page). */
function isRealTab(tab: BrowserTab): boolean {
  if (!tab.url) return false;
  if (tab.url === 'about:blank') return false;
  if (tab.url.startsWith('data:text/html')) return false;
  return true;
}

function TabItem({ tab, onSwitch, onClose }: { 
  tab: BrowserTab; 
  onSwitch: () => void; 
  onClose: (e: React.MouseEvent) => void;
}) {
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

// Keys that map directly to Playwright key names
const SPECIAL_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Space',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export function BrowserWindow({ config: _config }: BrowserWindowProps) {
  const computer = useComputerStore((s) => s.computer);
  const browserState = useComputerStore((s) => s.browserState);
  const navigateTo = useComputerStore((s) => s.navigateTo);
  const switchTab = useComputerStore((s) => s.switchTab);
  const closeTab = useComputerStore((s) => s.closeTab);

  const isRunning = computer && computer.status === 'running';

  const url = browserState.url || '';
  const pageTitle = browserState.title || '';
  const isLoading = browserState.isLoading;
  const connected = browserState.connected;
  const screenshot = browserState.screenshot;
  const tabs = browserState.tabs;
  const tinyfishStreamUrl = browserState.tinyfishStreamUrl;

  const frameSrc = screenshot
    ? `data:image/${screenshot.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${screenshot}`
    : null;

  const realTabs = tabs.filter(isRealTab);
  // Show tab bar when there are multiple tabs (even if some are new-tab pages)
  const showTabBar = tabs.length > 1;
  const hasRealContent = realTabs.length > 0 || !!frameSrc;
  const isActive = hasRealContent || !!tinyfishStreamUrl;

  // Whether the interactive viewport div is mounted (controls effect re-runs)
  const viewportMounted = !tinyfishStreamUrl && !!frameSrc;

  // ── Lock state (locked = agent-only, unlocked = user + agent) ──────────
  const [locked, setLocked] = useState(true);

  // ── FPS counter ─────────────────────────────────────────────────────────
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const prevScreenshotRef = useRef(screenshot);

  // Count each new frame
  if (screenshot !== prevScreenshotRef.current) {
    prevScreenshotRef.current = screenshot;
    frameCountRef.current++;
  }

  // Sample FPS every second
  useEffect(() => {
    const id = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── URL bar editing state ──────────────────────────────────────────────
  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  // ── Refs for interactive viewport ──────────────────────────────────────
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollDeltaRef = useRef(0);
  const scrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref so the wheel handler always reads the latest lock state without
  // needing to re-attach the native event listener on every toggle.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // ── Coordinate mapping: display space -> browser viewport space ────────
  const mapToViewport = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img || !img.naturalWidth || !img.naturalHeight) return null;

      const rect = img.getBoundingClientRect();
      const { naturalWidth, naturalHeight } = img;
      const displayAspect = rect.width / rect.height;
      const imageAspect = naturalWidth / naturalHeight;

      let renderedW: number, renderedH: number, offX: number, offY: number;
      if (displayAspect > imageAspect) {
        renderedH = rect.height;
        renderedW = renderedH * imageAspect;
        offX = (rect.width - renderedW) / 2;
        offY = 0;
      } else {
        renderedW = rect.width;
        renderedH = renderedW / imageAspect;
        offX = 0;
        offY = (rect.height - renderedH) / 2;
      }

      const relX = clientX - rect.left - offX;
      const relY = clientY - rect.top - offY;

      if (relX < 0 || relY < 0 || relX > renderedW || relY > renderedH) return null;

      return {
        x: Math.round((relX / renderedW) * naturalWidth),
        y: Math.round((relY / renderedH) * naturalHeight),
      };
    },
    [],
  );

  // ── Click handler ──────────────────────────────────────────────────────
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (locked) return;
      const coords = mapToViewport(e.clientX, e.clientY);
      if (!coords) return;
      browserWS.sendAction({ type: 'click', x: coords.x, y: coords.y });
      viewportRef.current?.focus();
    },
    [mapToViewport, locked],
  );

  // ── Double-click handler ───────────────────────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (locked) return;
      const coords = mapToViewport(e.clientX, e.clientY);
      if (!coords) return;
      browserWS.sendAction({ type: 'doubleclick', x: coords.x, y: coords.y });
    },
    [mapToViewport, locked],
  );

  // ── Scroll handler (non-passive, via ref) ──────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const flush = () => {
      const delta = Math.round(scrollDeltaRef.current);
      scrollDeltaRef.current = 0;
      if (delta !== 0) {
        browserWS.sendAction({ type: 'scroll', deltaY: delta });
      } else if (scrollTimerRef.current) {
        clearInterval(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (lockedRef.current) return;
      e.preventDefault();
      scrollDeltaRef.current += e.deltaY;
      if (!scrollTimerRef.current) {
        scrollTimerRef.current = setInterval(flush, 100);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (scrollTimerRef.current) {
        clearInterval(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [viewportMounted]);

  // ── Keyboard handler ───────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (locked) return;

    if (e.key === 'Escape') {
      viewportRef.current?.blur();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      let combo = '';
      if (e.ctrlKey) combo += 'Control+';
      if (e.shiftKey) combo += 'Shift+';
      if (e.altKey) combo += 'Alt+';
      combo += e.key.length === 1 ? e.key.toLowerCase() : e.key;
      browserWS.sendAction({ type: 'keypress', key: combo });
      return;
    }

    if (SPECIAL_KEYS.has(e.key)) {
      let key = e.key;
      if (e.shiftKey) key = `Shift+${key}`;
      if (e.altKey) key = `Alt+${key}`;
      browserWS.sendAction({ type: 'keypress', key });
    } else if (e.key.length === 1) {
      browserWS.sendAction({ type: 'type', text: e.key });
    }
  }, [locked]);

  // ── Navigation button handlers ─────────────────────────────────────────
  const handleBack = useCallback(() => {
    browserWS.sendAction({ type: 'back' });
  }, []);
  const handleForward = useCallback(() => {
    browserWS.sendAction({ type: 'forward' });
  }, []);
  const handleRefresh = useCallback(() => {
    browserWS.sendAction({ type: 'refresh' });
  }, []);

  // ── URL bar handlers ───────────────────────────────────────────────────
  const handleUrlClick = useCallback(() => {
    if (locked) return;
    setUrlDraft(url);
    setUrlEditing(true);
    requestAnimationFrame(() => urlInputRef.current?.select());
  }, [locked, url]);

  const handleUrlSubmit = useCallback(() => {
    setUrlEditing(false);
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    // Auto-add protocol if missing
    const target = /^https?:\/\//.test(trimmed) ? trimmed
      : /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmed) ? `https://${trimmed}`
      : trimmed;
    navigateTo(target);
  }, [urlDraft, navigateTo]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUrlSubmit();
    } else if (e.key === 'Escape') {
      setUrlEditing(false);
    }
  }, [handleUrlSubmit]);

  const handleSwitchTab = (tabId: string) => {
    switchTab(tabId);
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  // ── Idle state ─────────────────────────────────────────────────────────
  if (!isActive) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
        <div className="flex-1 flex items-center justify-center bg-neutral-900">
          <p className="text-sm text-[var(--color-text-muted)] opacity-40">
            {isRunning ? 'Waiting for Construct agent...' : 'Not connected'}
          </p>
        </div>
        <div className="shrink-0 flex items-center justify-end px-2 py-1 text-xs border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
          <div className="flex flex-col items-center gap-0.5" title={connected ? 'Connected' : 'Disconnected'}>
            <span className={`w-[6px] h-[6px] rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-[8px] leading-none opacity-40">{fps}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
      {/* Tab bar — show all tabs when multiple exist */}
      {showTabBar && !tinyfishStreamUrl && (
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
      {!tinyfishStreamUrl && (
        <div className="shrink-0 flex items-center gap-1 p-1 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <button
            className="p-1 rounded-md hover:bg-[var(--color-surface)] disabled:opacity-30 disabled:pointer-events-none"
            onClick={handleBack}
            disabled={locked}
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            className="p-1 rounded-md hover:bg-[var(--color-surface)] disabled:opacity-30 disabled:pointer-events-none"
            onClick={handleForward}
            disabled={locked}
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            className={`p-1 rounded-md hover:bg-[var(--color-surface)] disabled:opacity-30 disabled:pointer-events-none ${isLoading ? 'animate-spin' : ''}`}
            onClick={handleRefresh}
            disabled={locked}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* URL bar */}
          <div
            className={`flex-1 flex items-center gap-2 px-2 py-1 text-xs font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md ${!locked ? 'cursor-text' : ''}`}
            onClick={handleUrlClick}
          >
            <Globe className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />
            {urlEditing ? (
              <input
                ref={urlInputRef}
                className="flex-1 bg-transparent outline-none text-[var(--color-text)]"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={handleUrlKeyDown}
                onBlur={() => setUrlEditing(false)}
                spellCheck={false}
                autoFocus
              />
            ) : (
              <span className="truncate text-[var(--color-text-muted)]">{url || 'about:blank'}</span>
            )}
          </div>
        </div>
      )}

      {/* Browser content */}
      <div className="flex-1 min-h-0 overflow-hidden bg-neutral-800 relative flex items-center justify-center">
        {/* TinyFish live stream overlay */}
        {tinyfishStreamUrl ? (
          <div className="absolute inset-0 z-10 flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-900/90 text-amber-200 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
              </span>
              TinyFish Web Agent working...
            </div>
            <div className="flex-1 w-full relative">
              <iframe
                src={tinyfishStreamUrl}
                className="absolute inset-0 w-full h-full border-none bg-white"
                sandbox="allow-scripts allow-same-origin"
                title="TinyFish Live Browser Stream"
              />
              <div className="absolute inset-0 z-10" />
            </div>
          </div>
        ) : null}

        {/* Viewport */}
        {!tinyfishStreamUrl && frameSrc ? (
          <div
            ref={viewportRef}
            className={`w-full h-full relative outline-none ${locked ? 'cursor-default' : 'cursor-default'}`}
            tabIndex={locked ? undefined : 0}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
          >
            <img
              ref={imgRef}
              src={frameSrc}
              alt="Browser"
              className="w-full h-full object-contain pointer-events-none select-none"
              draggable={false}
            />
            {/* Interaction-blocking overlay when locked */}
            {locked && <div className="absolute inset-0 z-10" />}
          </div>
        ) : !tinyfishStreamUrl ? (
          <div className="text-center text-[var(--color-text-muted)]">
            <Globe className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Loading...</p>
          </div>
        ) : null}
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 text-xs border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
        <span className="truncate">{isLoading ? 'Loading...' : pageTitle || 'Ready'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {tinyfishStreamUrl ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400"></span>
              </span>
              TinyFish
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-border)] text-[var(--color-text-muted)]">
              Local
            </span>
          )}
          {/* Lock · dot · fps */}
          <div className="flex items-center gap-1.5">
            <button
              className="opacity-40 hover:opacity-70 transition-opacity"
              onClick={() => setLocked((v) => !v)}
              title={locked ? 'Unlock user interaction' : 'Lock to agent-only'}
            >
              {locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
            </button>
            <span
              className={`w-[5px] h-[5px] rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
              title={connected ? 'Connected' : 'Disconnected'}
            />
            <span className="text-[9px] leading-none opacity-30 tabular-nums">{fps}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
