import { useState, useRef, useCallback, useEffect } from 'react';
import {
  RefreshCw, ArrowLeft, ArrowRight, Globe, X, Plus,
  Monitor, Lock, Unlock, Loader2,
} from 'lucide-react';
import { useComputerStore, type BrowserTab } from '@/stores/agentStore';
import { browserWS } from '@/services/websocket';
import type { WindowConfig } from '@/types';

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const SPECIAL_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Space',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function isRealTab(tab: BrowserTab): boolean {
  if (!tab.url) return false;
  if (tab.url === 'about:blank') return false;
  if (tab.url.startsWith('data:text/html')) return false;
  return true;
}

function tabDisplayTitle(tab: BrowserTab): string {
  if (tab.title) return tab.title;
  try { return new URL(tab.url).hostname || 'New Tab'; } catch { return 'New Tab'; }
}

function normaliseUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})/.test(t)) return `https://${t}`;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function Tab({
  tab, onSwitch, onClose,
}: {
  tab: BrowserTab;
  onSwitch: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`
        group relative flex items-center gap-1.5 pl-2.5 pr-1.5 h-full text-[11px] cursor-pointer
        select-none whitespace-nowrap min-w-[60px] max-w-[180px] transition-colors
        ${tab.active
          ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}
      `}
      onClick={onSwitch}
      title={tab.url}
    >
      <Globe className="w-3 h-3 shrink-0 opacity-40" />
      <span className="truncate flex-1">{tabDisplayTitle(tab)}</span>
      <button
        className="shrink-0 p-0.5 rounded-sm opacity-0 group-hover:opacity-100
                   hover:bg-[var(--color-border)] transition-opacity"
        onClick={onClose}
        title="Close tab"
      >
        <X className="w-3 h-3" />
      </button>
      {tab.active && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-accent)]" />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════════════════ */

interface BrowserWindowProps { config: WindowConfig; }

export function BrowserWindow({ config: _config }: BrowserWindowProps) {
  /* ── Store ──────────────────────────────────────────────────────────────── */
  const computer   = useComputerStore((s) => s.computer);
  const browser    = useComputerStore((s) => s.browserState);
  const navigateTo = useComputerStore((s) => s.navigateTo);
  const switchTab  = useComputerStore((s) => s.switchTab);
  const closeTab   = useComputerStore((s) => s.closeTab);
  const newTab     = useComputerStore((s) => s.newTab);

  const isRunning  = computer?.status === 'running';
  const connected  = browser.connected;
  const tabs       = browser.tabs;
  const url        = browser.url || '';
  const pageTitle  = browser.title || '';
  const isLoading  = browser.isLoading;
  const screenshot = browser.screenshot;
  const tinyfishStreamUrl = browser.tinyfishStreamUrl;

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const frameSrc = screenshot
    ? `data:image/${screenshot.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${screenshot}`
    : null;
  const hasContent = tabs.some(isRealTab) || !!frameSrc;
  const showingTinyfish = !!tinyfishStreamUrl;

  /* ── Lock (viewport only) ───────────────────────────────────────────────── */
  const [locked, setLocked] = useState(true);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  /* ── URL bar ────────────────────────────────────────────────────────────── */
  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  /* ── FPS ─────────────────────────────────────────────────────────────────── */
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const prevScreenshotRef = useRef(screenshot);
  if (screenshot !== prevScreenshotRef.current) {
    prevScreenshotRef.current = screenshot;
    frameCountRef.current++;
  }
  useEffect(() => {
    const id = setInterval(() => { setFps(frameCountRef.current); frameCountRef.current = 0; }, 1000);
    return () => clearInterval(id);
  }, []);

  /* ── TinyFish health ────────────────────────────────────────────────────── */
  const iframeLoadCount = useRef(0);
  const [iframeDead, setIframeDead] = useState(false);
  useEffect(() => { iframeLoadCount.current = 0; setIframeDead(false); }, [tinyfishStreamUrl]);
  const onIframeLoad  = useCallback(() => { if (++iframeLoadCount.current > 1) setIframeDead(true); }, []);
  const onIframeError = useCallback(() => setIframeDead(true), []);

  /* ── Viewport refs ──────────────────────────────────────────────────────── */
  const imgRef      = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollDelta = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Coord mapping ──────────────────────────────────────────────────────── */
  const mapToViewport = useCallback((cx: number, cy: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img?.naturalWidth || !img?.naturalHeight) return null;
    const r = img.getBoundingClientRect();
    const da = r.width / r.height, ia = img.naturalWidth / img.naturalHeight;
    let rw: number, rh: number, ox: number, oy: number;
    if (da > ia) { rh = r.height; rw = rh * ia; ox = (r.width - rw) / 2; oy = 0; }
    else         { rw = r.width;  rh = rw / ia; ox = 0; oy = (r.height - rh) / 2; }
    const rx = cx - r.left - ox, ry = cy - r.top - oy;
    if (rx < 0 || ry < 0 || rx > rw || ry > rh) return null;
    return { x: Math.round((rx / rw) * img.naturalWidth), y: Math.round((ry / rh) * img.naturalHeight) };
  }, []);

  /* ── Viewport handlers ──────────────────────────────────────────────────── */
  const onViewportClick = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    const c = mapToViewport(e.clientX, e.clientY);
    if (c) browserWS.sendAction({ type: 'click', x: c.x, y: c.y });
    viewportRef.current?.focus();
  }, [mapToViewport, locked]);

  const onViewportDblClick = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    const c = mapToViewport(e.clientX, e.clientY);
    if (c) browserWS.sendAction({ type: 'doubleclick', x: c.x, y: c.y });
  }, [mapToViewport, locked]);

  const viewportMounted = !showingTinyfish && !!frameSrc;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const flush = () => {
      const d = Math.round(scrollDelta.current); scrollDelta.current = 0;
      if (d !== 0) browserWS.sendAction({ type: 'scroll', deltaY: d });
      else if (scrollTimer.current) { clearInterval(scrollTimer.current); scrollTimer.current = null; }
    };
    const onWheel = (e: WheelEvent) => {
      if (lockedRef.current) return;
      e.preventDefault();
      scrollDelta.current += e.deltaY;
      if (!scrollTimer.current) scrollTimer.current = setInterval(flush, 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (scrollTimer.current) { clearInterval(scrollTimer.current); scrollTimer.current = null; }
    };
  }, [viewportMounted]);

  const onViewportKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (locked) return;
    if (e.key === 'Escape') { viewportRef.current?.blur(); return; }
    e.preventDefault(); e.stopPropagation();
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

  /* ── Chrome actions ─────────────────────────────────────────────────────── */
  const goBack    = useCallback(() => browserWS.sendAction({ type: 'back' }), []);
  const goForward = useCallback(() => browserWS.sendAction({ type: 'forward' }), []);
  const refresh   = useCallback(() => browserWS.sendAction({ type: 'refresh' }), []);

  const startEditUrl = useCallback(() => {
    setUrlDraft(url);
    setUrlEditing(true);
    requestAnimationFrame(() => urlInputRef.current?.select());
  }, [url]);

  const commitUrl = useCallback(() => {
    setUrlEditing(false);
    const target = normaliseUrl(urlDraft);
    if (target) navigateTo(target);
  }, [urlDraft, navigateTo]);

  const onUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitUrl();
    else if (e.key === 'Escape') setUrlEditing(false);
  }, [commitUrl]);

  const toggleLock = useCallback(() => setLocked((v) => !v), []);

  /* ═════════════════════════════════════════════════════════════════════════
     Render
     ═════════════════════════════════════════════════════════════════════════ */

  const chromeProps: ChromeProps = {
    tabs, url, isLoading, locked,
    urlEditing, urlDraft, urlInputRef,
    onNewTab: () => newTab(),
    onSwitchTab: (id) => switchTab(id),
    onCloseTab: (id) => closeTab(id),
    onBack: goBack, onForward: goForward, onRefresh: refresh,
    onStartEditUrl: startEditUrl,
    onUrlChange: (v) => setUrlDraft(v),
    onUrlKeyDown, onUrlBlur: () => setUrlEditing(false),
    onToggleLock: toggleLock,
  };

  // Not connected
  if (!isRunning || !connected) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
        <Chrome {...chromeProps}
          tabs={[]} url="" isLoading={false}
          onNewTab={() => {}} onSwitchTab={() => {}} onCloseTab={() => {}}
          onBack={() => {}} onForward={() => {}} onRefresh={() => {}}
          onStartEditUrl={() => {}} onUrlChange={() => {}} onUrlKeyDown={() => {}} onUrlBlur={() => {}}
          onToggleLock={() => {}}
          disabled
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--color-text-subtle)]">
            {isRunning ? 'Connecting...' : 'Not connected'}
          </p>
        </div>
        <StatusBar connected={false} fps={0} locked={locked} onToggleLock={() => {}} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
      {!showingTinyfish && <Chrome {...chromeProps} />}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden relative flex items-center justify-center"
           style={{ background: 'black' }}>

        {showingTinyfish && (
          <TinyfishOverlay
            streamUrl={tinyfishStreamUrl!} isDead={iframeDead}
            onLoad={onIframeLoad} onError={onIframeError}
          />
        )}

        {!showingTinyfish && frameSrc ? (
          <div
            ref={viewportRef}
            className={`w-full h-full relative outline-none ${locked ? 'cursor-default' : 'cursor-crosshair'}`}
            tabIndex={locked ? undefined : 0}
            onClick={onViewportClick}
            onDoubleClick={onViewportDblClick}
            onKeyDown={onViewportKeyDown}
          >
            <img ref={imgRef} src={frameSrc} alt=""
              className="w-full h-full object-contain pointer-events-none select-none" draggable={false} />
            {locked && <div className="absolute inset-0 z-10" />}
          </div>
        ) : !showingTinyfish ? (
          <div className="flex flex-col items-center gap-3 text-[var(--color-text-subtle)]">
            <Globe className="w-10 h-10 opacity-20" />
            <p className="text-xs">
              {hasContent ? 'Loading...' : 'Type a URL above to get started'}
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <StatusBar
        connected={connected} fps={fps} locked={locked} onToggleLock={toggleLock}
        pageTitle={pageTitle} isLoading={isLoading} tinyfishActive={showingTinyfish}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Chrome (tab strip + address bar)
   ═══════════════════════════════════════════════════════════════════════════ */

interface ChromeProps {
  tabs: BrowserTab[];
  url: string;
  isLoading: boolean;
  locked: boolean;
  urlEditing: boolean;
  urlDraft: string;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onNewTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStartEditUrl: () => void;
  onUrlChange: (value: string) => void;
  onUrlKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onUrlBlur: () => void;
  onToggleLock: () => void;
  disabled?: boolean;
}

function Chrome({
  tabs, url, isLoading, locked,
  urlEditing, urlDraft, urlInputRef,
  onNewTab, onSwitchTab, onCloseTab,
  onBack, onForward, onRefresh,
  onStartEditUrl, onUrlChange, onUrlKeyDown, onUrlBlur,
  onToggleLock, disabled,
}: ChromeProps) {
  // Controls are disabled when not connected OR when viewport is locked
  const controlsOff = disabled || locked;

  return (
    <div className="shrink-0">
      {/* ── Tab strip ──────────────────────────────────────────────────── */}
      <div className="flex items-stretch h-[30px] bg-[var(--color-surface-raised)] border-b border-[var(--color-border)]">
        <div className={`flex items-stretch overflow-x-auto flex-1 min-w-0 scrollbar-none ${controlsOff ? 'pointer-events-none opacity-60' : ''}`}>
          {tabs.map((tab) => (
            <Tab
              key={tab.id} tab={tab}
              onSwitch={() => onSwitchTab(tab.id)}
              onClose={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            />
          ))}
        </div>
        <button
          className="shrink-0 px-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                     hover:bg-[var(--color-surface)] transition-colors disabled:opacity-30"
          onClick={onNewTab} disabled={controlsOff} title="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Address bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[var(--color-surface-raised)] border-b border-[var(--color-border)]">
        <NavButton icon={ArrowLeft}  onClick={onBack}    disabled={controlsOff} title="Back" />
        <NavButton icon={ArrowRight} onClick={onForward} disabled={controlsOff} title="Forward" />
        <NavButton
          icon={isLoading ? Loader2 : RefreshCw}
          onClick={onRefresh} disabled={controlsOff} title="Refresh" spin={isLoading}
        />

        {/* URL input */}
        <div
          className={`
            flex-1 min-w-0 flex items-center gap-2 h-[28px] px-2.5 text-[12px] font-mono
            rounded-[var(--radius-input)]
            bg-[var(--color-surface)] border border-[var(--color-border)] transition-colors
            ${!controlsOff ? 'cursor-text hover:border-[var(--color-border-strong)] focus-within:border-[var(--color-accent)]/60' : 'opacity-50 cursor-default'}
          `}
          onClick={controlsOff ? undefined : onStartEditUrl}
        >
          <Globe className="w-3 h-3 text-[var(--color-text-subtle)] shrink-0" />
          {urlEditing && !controlsOff ? (
            <input
              ref={urlInputRef}
              className="flex-1 min-w-0 bg-transparent outline-none text-[var(--color-text)]
                         placeholder:text-[var(--color-text-subtle)]"
              value={urlDraft}
              onChange={(e) => onUrlChange(e.target.value)}
              onKeyDown={onUrlKeyDown}
              onBlur={onUrlBlur}
              placeholder="Enter URL..."
              spellCheck={false}
              autoFocus
            />
          ) : (
            <span className="truncate text-[var(--color-text-muted)] flex-1">
              {url || 'Enter URL...'}
            </span>
          )}
        </div>

        {/* Lock toggle — always enabled so user can unlock */}
        <button
          className={`
            shrink-0 p-1.5 rounded-[var(--radius-button)] transition-colors
            ${locked
              ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
              : 'text-[var(--color-accent)] bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-muted)]'}
          `}
          onClick={onToggleLock}
          title={locked ? 'Unlock viewport — allow mouse/keyboard interaction' : 'Lock viewport — agent only'}
        >
          {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NavButton
   ═══════════════════════════════════════════════════════════════════════════ */

function NavButton({
  icon: Icon, onClick, disabled, title, spin,
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  spin?: boolean;
}) {
  return (
    <button
      className="p-1 rounded-[var(--radius-button)] text-[var(--color-text-muted)]
                 hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]
                 disabled:opacity-25 disabled:pointer-events-none transition-colors"
      onClick={onClick} disabled={disabled} title={title}
    >
      <Icon className={`w-3.5 h-3.5 ${spin ? 'animate-spin' : ''}`} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TinyFish overlay
   ═══════════════════════════════════════════════════════════════════════════ */

function TinyfishOverlay({
  streamUrl, isDead, onLoad, onError,
}: {
  streamUrl: string; isDead: boolean; onLoad: () => void; onError: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5
                      bg-[var(--color-warning-muted)] text-[var(--color-warning)] text-xs
                      border-b border-[var(--color-border)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-warning)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-warning)]" />
        </span>
        TinyFish Web Agent working...
      </div>

      {isDead ? (
        <div className="flex-1 flex items-center justify-center bg-[var(--color-surface)]">
          <div className="text-center text-[var(--color-text-muted)]">
            <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">TinyFish is working in the background</p>
            <p className="text-xs mt-1 text-[var(--color-text-subtle)]">
              Live preview disconnected — results will appear in chat
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative">
          <iframe
            src={streamUrl}
            className="absolute inset-0 w-full h-full border-none bg-white"
            sandbox="allow-scripts allow-same-origin"
            title="TinyFish Live Browser Stream"
            onLoad={onLoad} onError={onError}
          />
          <div className="absolute inset-0 z-10" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Status bar
   ═══════════════════════════════════════════════════════════════════════════ */

function StatusBar({
  connected, fps, locked, onToggleLock,
  pageTitle, isLoading, tinyfishActive,
}: {
  connected: boolean; fps: number; locked: boolean; onToggleLock: () => void;
  pageTitle?: string; isLoading?: boolean; tinyfishActive?: boolean;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between h-[22px] px-2 text-[10px]
                    border-t border-[var(--color-border)] bg-[var(--color-surface-raised)]
                    text-[var(--color-text-muted)]">
      <span className="truncate mr-4">
        {isLoading ? 'Loading...' : pageTitle || ''}
      </span>

      <div className="flex items-center gap-2 shrink-0">
        {tinyfishActive ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium
                           bg-[var(--color-warning-muted)] text-[var(--color-warning)]
                           border border-[var(--color-warning)]/25">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-warning)] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--color-warning)]" />
            </span>
            TinyFish
          </span>
        ) : (
          <span className="text-[9px] text-[var(--color-text-subtle)]">Local</span>
        )}

        <button
          className={`p-0.5 rounded transition-colors
            ${locked
              ? 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]'
              : 'text-[var(--color-accent)]'}`}
          onClick={onToggleLock}
          title={locked ? 'Unlock viewport interaction' : 'Lock viewport (agent only)'}
        >
          {locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
        </button>

        <span
          className={`w-[5px] h-[5px] rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />

        <span className="tabular-nums text-[var(--color-text-subtle)] w-[14px] text-right">{fps}</span>
      </div>
    </div>
  );
}
