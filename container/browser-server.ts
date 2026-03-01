/**
 * Browser Server — WebSocket bridge between the construct.computer backend
 * and agent-browser running inside the container.
 *
 * agent-browser manages Chromium via its daemon. This server:
 *   1. Starts agent-browser's daemon + streaming server
 *   2. Runs a WebSocket server on port 9222 (our existing protocol)
 *   3. Translates actions (navigate, click, type, etc.) to agent-browser CLI
 *   4. Relays screencast frames from agent-browser's stream server
 *   5. Manages tab metadata for the frontend
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import { execSync, spawn, type ChildProcess } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { connect as netConnect } from 'net'
import WebSocketClient from 'ws'

const PORT = 9222
const AGENT_BROWSER_STREAM_PORT = 9224 // internal streaming port
const VIEWPORT = { width: 1280, height: 720 }

// ─── Browser stealth overrides ──────────────────────────────────────────────
// Injected via `eval` after every navigation to make the headless browser
// appear as a regular user's Chrome — fixes Google Meet and other sites
// that fingerprint automation.

const STEALTH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.139 Safari/537.36'

const STEALTH_SCRIPT = `(() => {
  if (window.__stealthApplied) return;
  window.__stealthApplied = true;

  // 1. navigator.webdriver → false (on both instance AND prototype)
  Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  try {
    // Also patch the prototype so 'webdriver' in navigator checks pass
    const proto = Object.getPrototypeOf(navigator);
    if (proto) {
      Object.defineProperty(proto, 'webdriver', { get: () => false, configurable: true });
    }
  } catch {}

  // 2. User-Agent override (removes "HeadlessChrome")
  Object.defineProperty(navigator, 'userAgent', {
    get: () => '${STEALTH_UA}'
  });
  Object.defineProperty(navigator, 'appVersion', {
    get: () => '${STEALTH_UA.replace('Mozilla/', '')}'
  });

  // 3. Fake plugins (Chrome normally has 5)
  // Use Object.create(PluginArray.prototype) so instanceof checks pass
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1, item: () => null, namedItem: () => null, [Symbol.iterator]: function*(){} },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, item: () => null, namedItem: () => null, [Symbol.iterator]: function*(){} },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 1, item: () => null, namedItem: () => null, [Symbol.iterator]: function*(){} },
        { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1, item: () => null, namedItem: () => null, [Symbol.iterator]: function*(){} },
        { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, item: () => null, namedItem: () => null, [Symbol.iterator]: function*(){} },
      ];
      const pluginArr = Object.create(PluginArray.prototype);
      for (let i = 0; i < fakePlugins.length; i++) pluginArr[i] = fakePlugins[i];
      Object.defineProperty(pluginArr, 'length', { get: () => fakePlugins.length });
      pluginArr.item = (i) => fakePlugins[i] || null;
      pluginArr.namedItem = (n) => fakePlugins.find(p => p.name === n) || null;
      pluginArr.refresh = () => {};
      pluginArr[Symbol.iterator] = function*() { for (const p of fakePlugins) yield p; };
      return pluginArr;
    }
  });

  // 4. Languages — clean (no @posix suffix)
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'language', { get: () => 'en-US' });

  // 5. Platform
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });

  // 6. Hardware concurrency (real value, not 0)
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });

  // 7. Device memory
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  // 8. Connection — mimic real network (use prototype override for read-only props)
  if (navigator.connection) {
    try {
      const connProto = Object.getPrototypeOf(navigator.connection);
      if (connProto) {
        Object.defineProperty(connProto, 'rtt', { get: () => 50, configurable: true });
      }
    } catch {}
    try {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
    } catch {}
  }

  // 9. Fake media devices for WebRTC (Google Meet, Zoom, etc.)
  if (navigator.mediaDevices) {
    const origEnum = navigator.mediaDevices.enumerateDevices?.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      try {
        const real = origEnum ? await origEnum() : [];
        if (real.length > 0) return real;
      } catch {}
      return [
        { deviceId: 'default', kind: 'audioinput', label: 'Default', groupId: 'default', toJSON() { return this; } },
        { deviceId: 'communications', kind: 'audioinput', label: 'Communications', groupId: 'comms', toJSON() { return this; } },
        { deviceId: 'default', kind: 'videoinput', label: 'Integrated Camera', groupId: 'camera', toJSON() { return this; } },
        { deviceId: 'default', kind: 'audiooutput', label: 'Default', groupId: 'default', toJSON() { return this; } },
      ];
    };
  }

  // 10. Permissions API — report granted for common permissions
  if (navigator.permissions) {
    const origQuery = navigator.permissions.query?.bind(navigator.permissions);
    navigator.permissions.query = (desc) => {
      const autoGrant = ['camera', 'microphone', 'notifications', 'geolocation'];
      if (autoGrant.includes(desc.name)) {
        return Promise.resolve({ state: 'granted', onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
      }
      return origQuery ? origQuery(desc) : Promise.resolve({ state: 'prompt', onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
    };
  }

  // 11. WebGL vendor/renderer — look real
  try {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)';
      return getParam.call(this, p);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (Intel)';
        if (p === 37446) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)';
        return getParam2.call(this, p);
      };
    }
  } catch {}

  // 12. Remove Playwright-injected __playwright properties
  try { delete window.__playwright; } catch {}
  try { delete window.__pw_manual; } catch {}

  // 13. window.chrome — Real Chrome ALWAYS has this object
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() { return { onMessage: { addListener: function(){} }, postMessage: function(){}, onDisconnect: { addListener: function(){} } }; },
      sendMessage: function() {},
      onMessage: { addListener: function(){}, removeListener: function(){}, hasListeners: function() { return false; } },
      onConnect: { addListener: function(){}, removeListener: function(){}, hasListeners: function() { return false; } },
      id: undefined,
    };
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        startE: Date.now(),
        onloadT: Date.now(),
        pageT: performance.now(),
        tran: 15,
      };
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      const perf = performance.timing;
      return {
        commitLoadTime: perf.responseStart / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: perf.domContentLoadedEventEnd / 1000,
        finishLoadTime: perf.loadEventEnd / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: perf.responseStart / 1000 + 0.05,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: perf.requestStart / 1000,
        startLoadTime: perf.navigationStart / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }

  // 14. Screen dimensions — should match Xvfb resolution (1920x1080), not viewport
  Object.defineProperty(screen, 'width', { get: () => 1920, configurable: true });
  Object.defineProperty(screen, 'height', { get: () => 1080, configurable: true });
  Object.defineProperty(screen, 'availWidth', { get: () => 1920, configurable: true });
  Object.defineProperty(screen, 'availHeight', { get: () => 1080, configurable: true });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });

  // 15. window.outerWidth/Height — in real browsers these include window chrome
  // outerWidth > innerWidth (toolbar, scrollbar ~40px difference)
  Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16, configurable: true });
  Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });

  // 16. Notification.permission — should be "default" for a fresh profile, not "denied"
  try {
    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
  } catch {}

  // 17. Hairline features — further reduce fingerprint surface
  // AudioContext: make createOscillator behave normally (not muted)
  try {
    const origCtx = window.AudioContext || window.webkitAudioContext;
    if (origCtx) {
      const origCreate = origCtx.prototype.createOscillator;
      // No-op wrap — just ensure it exists and is callable
      origCtx.prototype.createOscillator = function() { return origCreate.call(this); };
    }
  } catch {}
})();`

const STEALTH_SCRIPT_B64 = Buffer.from(STEALTH_SCRIPT).toString('base64')

// Path to the agent-browser daemon Unix socket for the default session
const DAEMON_SOCKET_PATH = '/home/sandbox/.agent-browser/default.sock'

/**
 * Send a command to the agent-browser daemon via its Unix socket.
 * Returns the parsed JSON response or throws on error.
 */
function daemonCommand(cmd: Record<string, unknown>, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(DAEMON_SOCKET_PATH)
    let data = ''
    const timer = setTimeout(() => { sock.destroy(); resolve({ success: true }) }, timeoutMs)

    sock.on('connect', () => {
      sock.write(JSON.stringify(cmd) + '\n')
    })
    sock.on('data', (chunk) => {
      data += chunk.toString()
      // Try to parse — the daemon sends a single JSON line
      try {
        const parsed = JSON.parse(data)
        clearTimeout(timer)
        sock.end()
        resolve(parsed)
      } catch { /* wait for more data */ }
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    sock.on('close', () => {
      clearTimeout(timer)
      if (data) {
        try { resolve(JSON.parse(data)) } catch { resolve({ success: false, error: data }) }
      }
    })
  })
}

// ─── System stats helpers ───────────────────────────────────────────────────

interface SystemStats {
  cpuPercent: number   // 0–100 of allocated CPU
  cpuCount: number     // vCPUs allocated to container
  memUsedBytes: number
  memTotalBytes: number
  diskUsedBytes: number
  diskTotalBytes: number
}

/**
 * Read a single-value cgroup file, returning its trimmed content or null.
 */
function readCgroupFile(path: string): string | null {
  try { return readFileSync(path, 'utf-8').trim() } catch { return null }
}

/**
 * Collect system stats from cgroup v2 (preferred) or v1 fallback.
 * `prevCpu` is the previous {usageUsec, wallUsec} for delta-based CPU%.
 */
function collectSystemStats(prevCpu: { usageUsec: number; wallUsec: number }): { stats: SystemStats; cpu: { usageUsec: number; wallUsec: number } } {
  let cpuPercent = 0
  let cpuCount = 1
  let usageUsec = 0
  const wallUsec = Date.now() * 1000

  // ── CPU ──────────────────────────────────────────────────────────────────
  // cgroup v2: /sys/fs/cgroup/cpu.stat  →  usage_usec <n>
  const cpuStat = readCgroupFile('/sys/fs/cgroup/cpu.stat')
  if (cpuStat) {
    const m = cpuStat.match(/usage_usec\s+(\d+)/)
    if (m) usageUsec = parseInt(m[1], 10)
  } else {
    // cgroup v1 fallback: /sys/fs/cgroup/cpuacct/cpuacct.usage  (nanoseconds)
    const v1 = readCgroupFile('/sys/fs/cgroup/cpuacct/cpuacct.usage')
    if (v1) usageUsec = Math.floor(parseInt(v1, 10) / 1000)
  }

  if (prevCpu.wallUsec > 0) {
    const dUsage = usageUsec - prevCpu.usageUsec
    const dWall = wallUsec - prevCpu.wallUsec
    if (dWall > 0) cpuPercent = Math.min(100, Math.max(0, (dUsage / dWall) * 100))
  }

  // vCPU count — read cgroup CPU quota to reflect container limits (not host CPUs)
  cpuCount = getCgroupCpuCount()

  // ── Memory ───────────────────────────────────────────────────────────────
  // Read from cgroup to reflect actual container limits (not host memory).
  // Usage is computed the same way `docker stats` does:
  //   used = memory.current - inactive_file (from memory.stat)
  let memUsedBytes = 0
  let memTotalBytes = 0

  // cgroup v2
  const memMax = readCgroupFile('/sys/fs/cgroup/memory.max')
  const memCurrent = readCgroupFile('/sys/fs/cgroup/memory.current')
  if (memMax && memMax !== 'max' && memCurrent) {
    memTotalBytes = parseInt(memMax, 10)
    const current = parseInt(memCurrent, 10)
    // Subtract inactive_file (reclaimable cache) for a fairer "used" value
    let inactiveFile = 0
    const memStat = readCgroupFile('/sys/fs/cgroup/memory.stat')
    if (memStat) {
      const m = memStat.match(/inactive_file\s+(\d+)/)
      if (m) inactiveFile = parseInt(m[1], 10)
    }
    memUsedBytes = Math.max(0, current - inactiveFile)
  } else {
    // cgroup v1
    const limitV1 = readCgroupFile('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    const usageV1 = readCgroupFile('/sys/fs/cgroup/memory/memory.usage_in_bytes')
    if (limitV1 && usageV1) {
      const limit = parseInt(limitV1, 10)
      // cgroup v1 uses a very large number (~2^63) to mean "unlimited"
      if (limit > 0 && limit < 2 ** 62) {
        memTotalBytes = limit
        const usage = parseInt(usageV1, 10)
        // Subtract inactive_file from v1 stat
        let inactiveFile = 0
        const statV1 = readCgroupFile('/sys/fs/cgroup/memory/memory.stat')
        if (statV1) {
          const m = statV1.match(/inactive_file\s+(\d+)/)
          if (m) inactiveFile = parseInt(m[1], 10)
        }
        memUsedBytes = Math.max(0, usage - inactiveFile)
      }
    }
  }

  // Fallback to /proc/meminfo if cgroup didn't provide values
  if (memTotalBytes === 0) {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf-8')
      const val = (key: string): number => {
        const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)\\s+kB`))
        return m ? parseInt(m[1], 10) * 1024 : 0
      }
      memTotalBytes = val('MemTotal')
      const memFree = val('MemFree')
      const buffers = val('Buffers')
      const cached = val('Cached') + val('SReclaimable')
      memUsedBytes = memTotalBytes - memFree - buffers - cached
      if (memUsedBytes < 0) memUsedBytes = memTotalBytes - memFree
    } catch { /* ignore */ }
  }

  // ── Disk ─────────────────────────────────────────────────────────────────
  let diskUsedBytes = 0
  let diskTotalBytes = 0
  try {
    const df = execSync("df / --output=used,size -B1 2>/dev/null | tail -1", {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    const parts = df.split(/\s+/)
    if (parts.length >= 2) {
      diskUsedBytes = parseInt(parts[0], 10)
      diskTotalBytes = parseInt(parts[1], 10)
    }
  } catch { /* ignore */ }

  return {
    stats: { cpuPercent, cpuCount, memUsedBytes, memTotalBytes, diskUsedBytes, diskTotalBytes },
    cpu: { usageUsec, wallUsec },
  }
}

/**
 * Get the number of CPUs allocated to this container via cgroup limits.
 * Falls back to /proc/cpuinfo (host CPUs) if no cgroup quota is set.
 */
function getCgroupCpuCount(): number {
  // cgroup v2: /sys/fs/cgroup/cpu.max  →  "quota period" e.g. "100000 100000" = 1 CPU
  const cpuMax = readCgroupFile('/sys/fs/cgroup/cpu.max')
  if (cpuMax) {
    const parts = cpuMax.split(/\s+/)
    if (parts.length >= 2 && parts[0] !== 'max') {
      const quota = parseInt(parts[0], 10)
      const period = parseInt(parts[1], 10)
      if (quota > 0 && period > 0) return Math.max(1, Math.ceil(quota / period))
    }
  }

  // cgroup v1: /sys/fs/cgroup/cpu/cpu.cfs_quota_us + cpu.cfs_period_us
  const quotaV1 = readCgroupFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')
  const periodV1 = readCgroupFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
  if (quotaV1 && periodV1) {
    const q = parseInt(quotaV1, 10)
    const p = parseInt(periodV1, 10)
    if (q > 0 && p > 0) return Math.max(1, Math.ceil(q / p))
  }

  // No cgroup quota — fall back to host CPU count
  try {
    const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8')
    return (cpuinfo.match(/^processor/gm) || []).length || 1
  } catch { return 1 }
}

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  // SGR sequences (\x1b[...m), OSC (\x1b]...\x07), and other CSI sequences
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '').replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '')
}

// ─── New tab page HTML ──────────────────────────────────────────────────────
const NEW_TAB_HTML = `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head><title>New Tab</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0a; min-height: 100vh; display: flex;
  align-items: center; justify-content: center; color: #fff;
}
p { font-size: 14px; color: rgba(255,255,255,0.25); font-weight: 400; }
</style>
</head>
<body>
  <p>Waiting for Construct agent...</p>
</body></html>`)}`

// ─── agent-browser CLI helper ───────────────────────────────────────────────

function agentBrowser(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('agent-browser', args, {
      timeout: timeoutMs,
      env: { ...process.env, AGENT_BROWSER_SESSION: 'default' },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `agent-browser exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

function agentBrowserJSON(args: string[], timeoutMs = 30_000): Promise<any> {
  return agentBrowser([...args, '--json'], timeoutMs).then((out) => {
    try { return JSON.parse(out) } catch { return { success: false, error: out } }
  })
}

// ─── Browser Server ─────────────────────────────────────────────────────────

interface TabInfo {
  id: string
  title: string
  url: string
  active: boolean
}

class BrowserServer {
  private clients = new Set<WebSocket>()
  private streamWs: WebSocketClient | null = null
  private streamReconnectTimer: NodeJS.Timeout | null = null
  private isLaunched = false
  private tabPollInterval: NodeJS.Timeout | null = null
  private isRecovering = false
  private consecutiveCrashes = 0
  private static readonly MAX_CRASH_RETRIES = 3
  private static readonly CRASH_COOLDOWN_MS = 5_000
  private prevCpu = { usageUsec: 0, wallUsec: 0 }
  private lastStats: SystemStats | null = null

  async start() {
    console.log('[BrowserServer] Starting with agent-browser backend...')

    // Launch agent-browser daemon with Chromium
    await this.launchBrowser()

    // Start HTTP + WebSocket server
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
      } else if (req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify(this.lastStats || {}))
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    const wss = new WebSocketServer({ server })

    wss.on('connection', (ws) => {
      console.log('[BrowserServer] Client connected')
      this.clients.add(ws)

      // Send initial frame + tabs + stats immediately so the frontend isn't blank
      this.sendFrameToClient(ws).catch(() => {})
      this.pollTabs().catch(() => {})
      if (this.lastStats) {
        ws.send(JSON.stringify({ type: 'stats', ...this.lastStats }))
      }

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString())
          await this.handleMessage(ws, msg)
        } catch (e) {
          console.error('[BrowserServer] Message error:', e)
        }
      })

      ws.on('close', () => {
        console.log('[BrowserServer] Client disconnected')
        this.clients.delete(ws)
      })
    })

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[BrowserServer] Listening on port ${PORT}`)
    })

    // Connect to agent-browser's stream server for screencast frames
    this.connectToStream()

    // Poll for tab updates periodically
    this.tabPollInterval = setInterval(() => this.pollTabs(), 2000)

    // Periodic health check: detect silently-crashed browser
    setInterval(() => this.healthCheck(), 30_000)

    // Broadcast system stats every 5 seconds
    // Seed the first CPU reading so the next tick has a delta
    const seed = collectSystemStats(this.prevCpu)
    this.prevCpu = seed.cpu
    this.lastStats = seed.stats
    setInterval(() => this.broadcastStats(), 5_000)
  }

  /**
   * Periodic health check — verify the browser is still responsive.
   * If it isn't, trigger automatic recovery.
   */
  private async healthCheck() {
    if (this.isRecovering || !this.isLaunched) return
    try {
      // A simple `get url` should succeed quickly if the browser is alive
      await agentBrowser(['get', 'url'], 10_000)
    } catch (e) {
      if (this.isCrashError(e)) {
        console.warn('[BrowserServer] Health check failed — browser appears crashed')
        await this.recoverBrowser()
      }
    }
  }

  private broadcastStats() {
    const { stats, cpu } = collectSystemStats(this.prevCpu)
    this.prevCpu = cpu
    this.lastStats = stats

    if (this.clients.size === 0) return

    const msg = JSON.stringify({ type: 'stats', ...stats })
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }

  private async launchBrowser() {
    console.log('[BrowserServer] Launching agent-browser...')

    try {
      // Check if there's already a running session we can reuse.
      // IMPORTANT: `agent-browser session` just echoes the session name from the
      // env var — it does NOT check whether a daemon is actually running.
      // We must use `agent-browser session list` which reports real active sessions.
      let hasActiveSession = false
      try {
        const listing = await agentBrowser(['session', 'list'], 5000)
        // Output is "No active sessions" when nothing is running,
        // or "Active sessions:\n→ default" when one is.
        if (listing && !listing.includes('No active sessions')) {
          hasActiveSession = true
        }
      } catch {
        // Command failed — treat as no active session
      }

      if (hasActiveSession) {
        console.log('[BrowserServer] Reusing existing agent-browser session')
        this.isLaunched = true
        return
      }

      // No active session — clean up any stale sockets/pids before launching
      try {
        execSync('rm -f /home/sandbox/.agent-browser/*.sock /home/sandbox/.agent-browser/*.pid /home/sandbox/.agent-browser/*.stream 2>/dev/null', { stdio: 'pipe' })
      } catch { /* ignore */ }

      // Open the new-tab page (this auto-launches the daemon)
      await agentBrowser([
        'open', NEW_TAB_HTML,
        '--headed',
      ], 60_000)
      this.isLaunched = true

      // Set viewport
      await agentBrowser(['set', 'viewport', String(VIEWPORT.width), String(VIEWPORT.height)])

      // Register stealth overrides as an init script — this runs BEFORE any page
      // JavaScript on every navigation, which is critical for beating detection
      // scripts that check navigator.webdriver etc. at page load time.
      await this.registerStealthInitScript()

      // Also inject into the current page immediately (for the initial about:blank/new-tab)
      await this.injectStealth()

      console.log('[BrowserServer] agent-browser launched successfully')
    } catch (e) {
      console.error('[BrowserServer] Failed to launch agent-browser:', e)
      throw e
    }
  }

  /**
   * Register the stealth script as a Playwright addInitScript via the daemon socket.
   * This ensures the script runs BEFORE any page JavaScript on every navigation —
   * critical for defeating detection that runs at page load time.
   * Also sets HTTP-level User-Agent header override.
   */
  private async registerStealthInitScript() {
    try {
      await daemonCommand({
        id: `stealth-init-${Date.now()}`,
        action: 'addinitscript',
        script: STEALTH_SCRIPT,
      })
      console.log('[BrowserServer] Stealth init script registered')
    } catch (e) {
      console.warn('[BrowserServer] Failed to register stealth init script:', e)
    }
    // Override HTTP User-Agent header (JS override only changes navigator.userAgent,
    // not the actual header sent with requests)
    try {
      await agentBrowser(['set', 'headers', JSON.stringify({ 'User-Agent': STEALTH_UA })], 5000)
      console.log('[BrowserServer] HTTP User-Agent header overridden')
    } catch {
      // Non-fatal — some agent-browser versions may not support this
    }
  }

  /**
   * Inject stealth overrides into the current page via eval (fallback).
   * Used for the initial page and as a safety net alongside addInitScript.
   */
  private async injectStealth() {
    try {
      await agentBrowser(['eval', '-b', STEALTH_SCRIPT_B64], 5000)
    } catch {
      // Non-fatal — page may not be ready yet
    }
  }

  /**
   * Detect if an error indicates a browser crash (OOM, renderer killed, etc.)
   */
  private isCrashError(error: unknown): boolean {
    const msg = String(error)
    return msg.includes('Page crashed') ||
      msg.includes('Target crashed') ||
      msg.includes('Session closed') ||
      msg.includes('browser has been closed') ||
      msg.includes('Browser closed') ||
      msg.includes('Connection refused')
  }

  /**
   * Recover from a browser crash by killing stale processes and re-launching.
   * Uses a mutex (isRecovering) to prevent concurrent recovery attempts.
   */
  private async recoverBrowser(): Promise<boolean> {
    if (this.isRecovering) return false
    this.isRecovering = true

    console.warn('[BrowserServer] Browser crash detected — starting recovery...')

    // Notify all clients that recovery is in progress
    const recoveryMsg = JSON.stringify({
      type: 'status',
      url: '',
      title: 'Browser recovering...',
      recovering: true,
    })
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(recoveryMsg)
      }
    }

    try {
      // 1. Kill all stale Chrome and agent-browser processes
      try {
        execSync('pkill -f chrome 2>/dev/null || true', { stdio: 'pipe', timeout: 5000 })
      } catch { /* ignore */ }
      try {
        execSync('pkill -f agent-browser 2>/dev/null || true', { stdio: 'pipe', timeout: 5000 })
      } catch { /* ignore */ }

      // Wait for processes to terminate
      await new Promise(r => setTimeout(r, 2000))

      // 2. Clean up stale agent-browser sockets/pids
      try {
        execSync('rm -f /home/sandbox/.agent-browser/*.sock /home/sandbox/.agent-browser/*.pid /home/sandbox/.agent-browser/*.stream 2>/dev/null', { stdio: 'pipe' })
      } catch { /* ignore */ }

      // 3. Re-launch the browser
      this.isLaunched = false
      await this.launchBrowser()

      // 4. Reconnect to the stream
      this.connectToStream()

      // 5. Send a fresh frame + tabs to all clients
      await new Promise(r => setTimeout(r, 1000))
      await this.broadcastFrame()
      await this.broadcastTabs()

      this.consecutiveCrashes = 0
      console.log('[BrowserServer] Browser recovery successful')
      return true
    } catch (e) {
      console.error('[BrowserServer] Browser recovery failed:', e)
      this.consecutiveCrashes++
      return false
    } finally {
      this.isRecovering = false
    }
  }

  /**
   * Wrapper that runs an action and triggers recovery on crash errors.
   * Returns the action result, or re-throws if recovery also fails.
   */
  private async withCrashRecovery<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (e) {
      if (this.isCrashError(e) && this.consecutiveCrashes < BrowserServer.MAX_CRASH_RETRIES) {
        const recovered = await this.recoverBrowser()
        if (recovered) {
          // Retry the action once after recovery
          return await action()
        }
      }
      throw e
    }
  }

  private connectToStream() {
    if (this.streamWs) {
      this.streamWs.close()
      this.streamWs = null
    }

    const url = `ws://127.0.0.1:${AGENT_BROWSER_STREAM_PORT}`
    console.log(`[BrowserServer] Connecting to stream at ${url}`)

    const ws = new WebSocketClient(url)

    ws.on('open', () => {
      console.log('[BrowserServer] Connected to agent-browser stream')
      this.streamWs = ws
    })

    ws.on('message', (data: Buffer) => {
      try {
        const str = data.toString()

        // Try JSON first: { type: 'frame', data: '<base64>' }
        if (str.charCodeAt(0) === 123 /* '{' */) {
          const msg = JSON.parse(str)
          if (msg.type === 'frame' && msg.data) {
            const frameMsg = JSON.stringify({ type: 'frame', data: msg.data })
            for (const client of this.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(frameMsg)
              }
            }
            return
          }
        }

        // Treat as raw binary image data (JPEG/PNG) — convert to base64
        if (data.length > 100) {
          const base64 = data.toString('base64')
          const frameMsg = JSON.stringify({ type: 'frame', data: base64 })
          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(frameMsg)
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    })

    ws.on('close', () => {
      console.log('[BrowserServer] Stream disconnected')
      this.streamWs = null
      this.scheduleStreamReconnect()
    })

    ws.on('error', () => {
      // Will trigger close
    })
  }

  private scheduleStreamReconnect() {
    if (this.streamReconnectTimer) return
    this.streamReconnectTimer = setTimeout(() => {
      this.streamReconnectTimer = null
      this.connectToStream()
    }, 2000)
  }

  private async getTabs(): Promise<TabInfo[]> {
    // Try JSON format first
    try {
      const result = await agentBrowserJSON(['tab'])
      if (result?.success && Array.isArray(result.data)) {
        return result.data.map((t: any, i: number) => ({
          id: `tab-${i}`,
          title: stripAnsi(t.title || ''),
          url: t.url || '',
          active: t.active ?? (i === 0),
        }))
      }
    } catch { /* fall through to text parsing */ }

    // Fallback: parse text output from `agent-browser tab`
    // Example output (with ANSI color codes):
    //   [0] The browser that puts you first | Brave
    //   \x1b[36m→\x1b[0m[1] cats - Brave Search
    // The → arrow marks the active tab.
    try {
      const raw = await agentBrowser(['tab'])
      const text = stripAnsi(raw)
      const tabs: TabInfo[] = []
      const lines = text.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Detect active marker: → prefix (after ANSI stripping) or (active) suffix
        const active = trimmed.startsWith('→') || trimmed.includes('(active)') || trimmed.startsWith('*')

        // Remove → / * prefix
        const clean = trimmed.replace(/^[→*]\s*/, '')

        // Extract tab index from [N] format
        const indexMatch = clean.match(/^\[(\d+)\]\s*(.*)$/)
        if (indexMatch) {
          const idx = parseInt(indexMatch[1], 10)
          const title = indexMatch[2].replace(/\s*\(active\)\s*$/, '').trim()
          tabs.push({ id: `tab-${idx}`, title, url: '', active })
        } else {
          // Fallback: use sequential index
          const idx = tabs.length
          const title = clean.replace(/^\d+[.):]\s*/, '').replace(/\s*\(active\)\s*$/, '').trim()
          tabs.push({ id: `tab-${idx}`, title, url: '', active })
        }
      }

      // If no tab marked active, mark the first one
      if (tabs.length > 0 && !tabs.some(t => t.active)) {
        tabs[0].active = true
      }

      return tabs.length > 0 ? tabs : [{ id: 'tab-0', title: 'New Tab', url: '', active: true }]
    } catch {
      return [{ id: 'tab-0', title: 'New Tab', url: '', active: true }]
    }
  }

  private async pollTabs() {
    if (this.clients.size === 0) return
    try {
      const tabs = await this.getTabs()
      // Enrich active tab with URL/title from get commands
      try {
        const urlResult = stripAnsi(await agentBrowser(['get', 'url']))
        const titleResult = stripAnsi(await agentBrowser(['get', 'title']))
        const activeTab = tabs.find(t => t.active)
        if (activeTab) {
          if (urlResult) activeTab.url = urlResult
          if (titleResult) activeTab.title = titleResult
        }
      } catch { /* ignore */ }

      const msg = JSON.stringify({ type: 'tabs', tabs })
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      }
    } catch {
      // Ignore poll errors
    }
  }

  private async broadcastTabs() {
    await this.pollTabs()
  }

  /** Take a screenshot and return it as base64, or null on failure */
  private async takeScreenshot(): Promise<string | null> {
    const screenshotPath = '/tmp/construct-frame.png'

    // Method 1: file-based screenshot (most reliable)
    try {
      await agentBrowser(['screenshot', screenshotPath])
      const fs = await import('fs')
      if (fs.existsSync(screenshotPath)) {
        const buffer = fs.readFileSync(screenshotPath)
        if (buffer.length > 0) return buffer.toString('base64')
      }
    } catch { /* try next method */ }

    // Method 2: JSON output
    try {
      const result = await agentBrowser(['screenshot', '--json'])
      const parsed = JSON.parse(result)
      if (parsed?.success && parsed.data?.base64) return parsed.data.base64
      if (parsed?.data?.screenshot) return parsed.data.screenshot
      if (typeof parsed?.screenshot === 'string') return parsed.screenshot
    } catch { /* try next method */ }

    // Method 3: bare screenshot to stdout (some versions output base64)
    try {
      const result = await agentBrowser(['screenshot'])
      // If the output looks like base64 (no whitespace, long string)
      if (result && result.length > 500 && !/\s/.test(result.slice(0, 100))) {
        return result
      }
    } catch { /* give up */ }

    return null
  }

  private async sendFrameToClient(ws: WebSocket) {
    const base64 = await this.takeScreenshot()
    if (base64 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'frame', data: base64 }))
    }
  }

  /** Broadcast a fresh screenshot to all connected clients */
  private async broadcastFrame() {
    if (this.clients.size === 0) return
    const base64 = await this.takeScreenshot()
    if (!base64) return
    const frameMsg = JSON.stringify({ type: 'frame', data: base64 })
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frameMsg)
      }
    }
  }

  private async handleMessage(ws: WebSocket, msg: any) {
    const { action, ...params } = msg

    const PAGE_CHANGING_ACTIONS = new Set([
      'navigate', 'back', 'forward', 'refresh', 'click', 'doubleclick', 'keypress',
    ])

    try {
      switch (action) {
        case 'navigate':
          if (params.url) {
            await agentBrowser(['open', params.url])
          }
          break

        case 'click':
          if (params.x !== undefined && params.y !== undefined) {
            // Use agent-browser's coordinate-based eval for click
            await agentBrowser(['eval', `document.elementFromPoint(${params.x}, ${params.y})?.click() || void(0)`])
              .catch(async () => {
                // Fallback to mouse commands
                await agentBrowser(['mouse', 'move', String(params.x), String(params.y)])
                await agentBrowser(['mouse', 'down'])
                await agentBrowser(['mouse', 'up'])
              })
          }
          break

        case 'doubleclick':
          if (params.x !== undefined && params.y !== undefined) {
            await agentBrowser(['mouse', 'move', String(params.x), String(params.y)])
            await agentBrowser(['mouse', 'down'])
            await agentBrowser(['mouse', 'up'])
            await agentBrowser(['mouse', 'down'])
            await agentBrowser(['mouse', 'up'])
          }
          break

        case 'type':
          if (params.text) {
            await agentBrowser(['keyboard', 'type', params.text])
          }
          break

        case 'keypress':
          if (params.key) {
            await agentBrowser(['press', params.key])
          }
          break

        case 'scroll':
          if (params.deltaY !== undefined) {
            const dir = params.deltaY > 0 ? 'down' : 'up'
            const px = Math.abs(params.deltaY)
            await agentBrowser(['scroll', dir, String(px)])
          }
          break

        case 'back':
          await agentBrowser(['back'])
          break

        case 'forward':
          await agentBrowser(['forward'])
          break

        case 'refresh':
          await agentBrowser(['reload'])
          break

        case 'newTab': {
          const url = params.url || undefined
          if (url) {
            await agentBrowser(['tab', 'new', url])
          } else {
            await agentBrowser(['tab', 'new'])
          }
          await new Promise(r => setTimeout(r, 500))
          await this.broadcastTabs()
          try {
            const newUrl = stripAnsi(await agentBrowser(['get', 'url']).catch(() => ''))
            const newTitle = stripAnsi(await agentBrowser(['get', 'title']).catch(() => ''))
            const statusMsg = JSON.stringify({ type: 'status', url: newUrl, title: newTitle })
            for (const client of this.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(statusMsg)
              }
            }
          } catch { /* ignore */ }
          await this.broadcastFrame()
          break
        }

        case 'closeTab': {
          if (params.tabId) {
            const idx = parseInt(params.tabId.replace('tab-', ''), 10)
            if (!isNaN(idx)) {
              try {
                await agentBrowser(['tab', 'close', String(idx)])
              } catch (e: any) {
                // agent-browser refuses to close the last tab —
                // navigate it to the new-tab page instead.
                if (String(e).includes('Cannot close the last tab')) {
                  await agentBrowser(['open', NEW_TAB_HTML])
                } else {
                  throw e
                }
              }
            }
          }
          await new Promise(r => setTimeout(r, 500))
          await this.broadcastTabs()
          try {
            const newUrl = stripAnsi(await agentBrowser(['get', 'url']).catch(() => ''))
            const newTitle = stripAnsi(await agentBrowser(['get', 'title']).catch(() => ''))
            const statusMsg = JSON.stringify({ type: 'status', url: newUrl, title: newTitle })
            for (const client of this.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(statusMsg)
              }
            }
          } catch { /* ignore */ }
          await this.broadcastFrame()
          break
        }

        case 'switchTab': {
          if (params.tabId) {
            const idx = parseInt(params.tabId.replace('tab-', ''), 10)
            if (!isNaN(idx)) {
              await agentBrowser(['tab', String(idx)])
              // Wait for the tab to become active and page to render
              await new Promise(r => setTimeout(r, 500))
            }
          }
          // Send updated tabs, status, and a fresh frame to ALL clients
          await this.broadcastTabs()
          try {
            const url = stripAnsi(await agentBrowser(['get', 'url']).catch(() => ''))
            const title = stripAnsi(await agentBrowser(['get', 'title']).catch(() => ''))
            const statusMsg = JSON.stringify({ type: 'status', url, title })
            for (const client of this.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(statusMsg)
              }
            }
          } catch { /* ignore */ }
          // Broadcast frame to all clients (not just the requester)
          await this.broadcastFrame()
          break
        }

        case 'getFrame':
          await this.sendFrameToClient(ws)
          return

        case 'getTabs':
          await this.broadcastTabs()
          return

        case 'getContent': {
          try {
            // Use agent-browser snapshot for content extraction
            const snapshot = await agentBrowser(['snapshot', '-i', '-c'])
            const url = stripAnsi(await agentBrowser(['get', 'url']).catch(() => ''))
            const title = stripAnsi(await agentBrowser(['get', 'title']).catch(() => ''))

            // Also get interactive elements with coordinates via eval
            const elementsJson = await agentBrowser(['eval', '-b', Buffer.from(`
              JSON.stringify(Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[onclick],[tabindex]')).slice(0, 50).map(el => {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                const s = window.getComputedStyle(el);
                if (s.display === 'none' || s.visibility === 'hidden') return null;
                return {
                  tag: el.tagName.toLowerCase(),
                  type: el.getAttribute('type') || undefined,
                  text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 100),
                  href: el.tagName === 'A' ? el.getAttribute('href') : undefined,
                  placeholder: el.getAttribute('placeholder') || undefined,
                  value: el.value || undefined,
                  x: Math.round(r.x + r.width / 2),
                  y: Math.round(r.y + r.height / 2),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                };
              }).filter(Boolean))
            `).toString('base64')]).catch(() => '[]')

            let elements: any[] = []
            try { elements = JSON.parse(elementsJson) } catch {}

            ws.send(JSON.stringify({
              type: 'content',
              url,
              title,
              text: snapshot.slice(0, 20000),
              elements,
              viewport: VIEWPORT,
            }))
          } catch (e) {
            ws.send(JSON.stringify({
              type: 'error',
              action: 'getContent',
              message: (e as Error).message,
            }))
          }
          return
        }

        case 'getStatus': {
          try {
            const url = stripAnsi(await agentBrowser(['get', 'url']).catch(() => ''))
            const title = stripAnsi(await agentBrowser(['get', 'title']).catch(() => ''))
            ws.send(JSON.stringify({ type: 'status', url, title }))
          } catch {
            ws.send(JSON.stringify({ type: 'status', url: '', title: '' }))
          }
          return
        }

        default:
          console.warn('[BrowserServer] Unknown action:', action)
      }

      ws.send(JSON.stringify({ type: 'ack', action }))

      if (PAGE_CHANGING_ACTIONS.has(action)) {
        // Re-inject stealth overrides after navigation (they don't persist across pages)
        setTimeout(() => {
          this.injectStealth().catch(() => {})
          this.broadcastTabs().catch(() => {})
        }, 500)
      }
    } catch (e) {
      console.error(`[BrowserServer] Action ${action} failed:`, e)

      // If this looks like a crash, attempt recovery
      if (this.isCrashError(e) && !this.isRecovering) {
        ws.send(JSON.stringify({ type: 'error', action, message: 'Browser crashed — recovering...', recovering: true }))
        const recovered = await this.recoverBrowser()
        if (recovered) {
          ws.send(JSON.stringify({ type: 'ack', action, recovered: true }))
          return
        }
      }

      ws.send(JSON.stringify({ type: 'error', action, message: (e as Error).message }))
    }
  }
}

const server = new BrowserServer()
server.start().catch(console.error)
