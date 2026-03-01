/**
 * Direct IPC client for the agent-browser daemon.
 *
 * Communicates via Unix domain socket using newline-delimited JSON,
 * bypassing the Rust CLI binary entirely. Benefits:
 *   - No process spawn overhead per command
 *   - args containing commas are preserved (JSON array, no splitting)
 *   - Lower latency for sequential commands
 *
 * The daemon is expected to already be running (started by browser-server.ts
 * via supervisor). If it isn't, we fall back to starting it ourselves.
 */

import { connect as netConnect, type Socket } from 'net';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Configuration ──────────────────────────────────────────────────────────

const SESSION = process.env.AGENT_BROWSER_SESSION || 'default';
const DEFAULT_TIMEOUT_MS = 60_000;

// Known locations for daemon.js (checked in order)
const DAEMON_JS_CANDIDATES = [
  // Container global npm install (Dockerfile: npm install -g agent-browser)
  '/usr/local/lib/node_modules/agent-browser/dist/daemon.js',
  // Alternative global install paths
  '/usr/lib/node_modules/agent-browser/dist/daemon.js',
];

// ─── Socket path resolution (mirrors daemon.js getSocketDir/getSocketPath) ──

function getSocketDir(): string {
  if (process.env.AGENT_BROWSER_SOCKET_DIR) {
    return process.env.AGENT_BROWSER_SOCKET_DIR;
  }
  if (process.env.XDG_RUNTIME_DIR) {
    return join(process.env.XDG_RUNTIME_DIR, 'agent-browser');
  }
  const home = process.env.HOME || homedir();
  if (home) {
    return join(home, '.agent-browser');
  }
  return join('/tmp', 'agent-browser');
}

function getSocketPath(): string {
  return join(getSocketDir(), `${SESSION}.sock`);
}

function getPidFile(): string {
  return join(getSocketDir(), `${SESSION}.pid`);
}

// ─── Daemon lifecycle ───────────────────────────────────────────────────────

function isDaemonRunning(): boolean {
  const pidFile = getPidFile();
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

function findDaemonJs(): string | null {
  if (process.env.AGENT_BROWSER_HOME) {
    const custom = join(process.env.AGENT_BROWSER_HOME, 'dist', 'daemon.js');
    if (existsSync(custom)) return custom;
  }
  for (const candidate of DAEMON_JS_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ensure the daemon is running. If not, start it and wait for the socket.
 * In the normal container flow, browser-server.ts starts the daemon first,
 * so this is a fallback for edge cases (e.g. boneclaw starts before browser-server).
 */
async function ensureDaemon(): Promise<void> {
  if (isDaemonRunning() && existsSync(getSocketPath())) return;

  const daemonJs = findDaemonJs();
  if (!daemonJs) {
    throw new Error(
      'Cannot find agent-browser daemon.js. ' +
      'Set AGENT_BROWSER_HOME or ensure agent-browser is installed globally.'
    );
  }

  const child = spawn('node', [daemonJs], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      AGENT_BROWSER_DAEMON: '1',
      AGENT_BROWSER_SESSION: SESSION,
    },
  });
  child.unref();

  // Wait for socket to appear (max 15 seconds)
  const deadline = Date.now() + 15_000;
  const socketPath = getSocketPath();
  while (!existsSync(socketPath) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!existsSync(socketPath)) {
    throw new Error('Agent-browser daemon failed to start (socket not created within 15s)');
  }
  // Brief extra wait for the socket listener to be fully ready
  await new Promise(r => setTimeout(r, 300));
}

// ─── IPC command sending ────────────────────────────────────────────────────

let cmdCounter = 0;

/**
 * Send a single JSON command to the daemon and return the parsed response.
 * Opens a new socket connection per command (matches the daemon's design:
 * it processes commands serially per connection).
 */
export async function sendCommand(
  command: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  await ensureDaemon();

  const id = `bc-${++cmdCounter}`;
  const payload = JSON.stringify({ id, ...command });
  const socketPath = getSocketPath();

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };

    const socket: Socket = netConnect(socketPath);

    const timer = setTimeout(() => {
      socket.destroy();
      settle(() => reject(new Error(`IPC timeout after ${timeoutMs}ms`)));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(payload + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.substring(0, newlineIdx);
        socket.end();
        try {
          settle(() => resolve(JSON.parse(line)));
        } catch {
          settle(() => resolve({ id, success: false, error: 'Invalid JSON response from daemon' }));
        }
      }
    });

    socket.on('error', (err) => {
      settle(() => reject(err));
    });

    socket.on('close', () => {
      // If we got data but no newline, try to parse what we have
      if (buffer.trim()) {
        try {
          settle(() => resolve(JSON.parse(buffer.trim())));
          return;
        } catch { /* fall through */ }
      }
      settle(() => reject(new Error('Daemon socket closed before response')));
    });
  });
}

/**
 * Check if the response indicates success.
 */
export function isSuccess(resp: Record<string, unknown>): boolean {
  return resp.success === true;
}

/**
 * Extract the text output from a daemon response for display to the LLM.
 */
export function responseToText(resp: Record<string, unknown>): string {
  if (!isSuccess(resp)) {
    return (resp.error as string) || 'Command failed';
  }
  const data = resp.data as Record<string, unknown> | undefined;
  if (!data) return 'OK';

  // Snapshot
  if (typeof data.snapshot === 'string') return data.snapshot;
  // Navigation
  if (data.url && data.title) return `URL: ${data.url}\nTitle: ${data.title}`;
  if (data.url) return `URL: ${data.url}`;
  if (data.title) return `Title: ${data.title}`;
  // Screenshot
  if (data.path) return `Screenshot saved: ${data.path}`;
  // Text content
  if (typeof data.text === 'string') return data.text;
  // Attribute
  if (data.attribute !== undefined) return `${data.attribute}: ${data.value ?? 'null'}`;
  // Count
  if (data.count !== undefined) return `Count: ${data.count}`;
  // Tabs
  if (Array.isArray(data.tabs)) {
    return (data.tabs as Array<Record<string, unknown>>)
      .map((t, i) => `[${i}] ${t.title || t.url || 'New Tab'}${t.active ? ' (active)' : ''}`)
      .join('\n');
  }
  // Boolean results
  if (data.clicked) return 'Clicked';
  if (data.launched) return 'Browser launched';
  if (data.waited) return 'Wait complete';
  if (data.closed) return 'Closed';
  // Generic
  return JSON.stringify(data);
}
