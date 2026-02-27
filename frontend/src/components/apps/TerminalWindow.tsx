import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useComputerStore } from '@/stores/agentStore';
import { terminalWS } from '@/services/websocket';
import type { WindowConfig } from '@/types';

const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#dcdcaa',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#dcdcaa',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

interface TerminalWindowProps {
  config: WindowConfig;
}

export function TerminalWindow({ config: _config }: TerminalWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const computer = useComputerStore((s) => s.computer);
  const instanceId = useComputerStore((s) => s.instanceId);
  const terminalConnected = useComputerStore((s) => s.terminalState.connected);

  const isRunning = computer && computer.status === 'running';

  // ── 1. Create xterm instance ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new XTerm({
      theme: TERMINAL_THEME,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: false,  // we handle CRLF on the backend
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(containerRef.current);

    // Initial fit
    requestAnimationFrame(() => fit.fit());

    xtermRef.current = xterm;
    fitRef.current = fit;

    // User keystrokes → websocket
    xterm.onData((data) => {
      terminalWS.sendInput(data);
    });

    // Send resize to backend when terminal dimensions change
    xterm.onResize(({ cols, rows }) => {
      terminalWS.resize(cols, rows);
    });

    // Resize when the window changes size
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fit.fit();
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ── 2. Wire up websocket when running ─────────────────────────
  // TerminalWindow owns the terminal WS lifecycle. We force-reconnect
  // every time deps change so xterm's onOutput handler is set BEFORE
  // the connection opens, guaranteeing we capture the initial prompt.
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;

    if (isRunning && instanceId) {
      // Wire output handler *before* opening the connection
      terminalWS.onOutput((data: string) => {
        xterm.write(data);
      });

      // Force a fresh connection so we always get a new PTY session
      // with xterm ready to receive the prompt.
      terminalWS.disconnect();
      terminalWS.connect(instanceId);
    } else {
      xterm.clear();
      xterm.writeln('\x1b[33mNot connected\x1b[0m');
      xterm.writeln('Start your computer to use the terminal.');
    }

    return () => {
      // Disconnect when the terminal window closes or deps change
      terminalWS.disconnect();
    };
  }, [isRunning, instanceId]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#1e1e1e' }}>
      {/* Header bar — always dark */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 text-xs border-b border-[#333] bg-[#252526] text-[#cccccc]">
        <span>~ — {terminalConnected ? 'connected' : 'disconnected'}</span>
        <span className="text-[#808080]">bash</span>
      </div>

      {/* Terminal canvas - min-h-0 is critical for flex child to not overflow */}
      <div ref={containerRef} className="flex-1 min-h-0 p-1 overflow-hidden" style={{ background: '#1e1e1e' }} />
    </div>
  );
}
