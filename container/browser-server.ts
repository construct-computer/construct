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
import WebSocketClient from 'ws'

const PORT = 9222
const AGENT_BROWSER_STREAM_PORT = 9224 // internal streaming port
const VIEWPORT = { width: 1280, height: 720 }

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

  // vCPU count from cgroup cpu.max (v2) or cpu.cfs_quota_us (v1)
  const cpuMax = readCgroupFile('/sys/fs/cgroup/cpu.max')
  if (cpuMax) {
    const [max, period] = cpuMax.split(/\s+/)
    cpuCount = max === 'max' ? countProcCpus() : Math.max(1, Math.round(parseInt(max, 10) / parseInt(period, 10)))
  } else {
    const quota = readCgroupFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')
    const period = readCgroupFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
    if (quota && period && parseInt(quota, 10) > 0) {
      cpuCount = Math.max(1, Math.round(parseInt(quota, 10) / parseInt(period, 10)))
    } else {
      cpuCount = countProcCpus()
    }
  }

  // ── Memory ───────────────────────────────────────────────────────────────
  let memUsedBytes = 0
  let memTotalBytes = 0

  // cgroup v2
  const memCurrent = readCgroupFile('/sys/fs/cgroup/memory.current')
  const memMax = readCgroupFile('/sys/fs/cgroup/memory.max')
  if (memCurrent) {
    memUsedBytes = parseInt(memCurrent, 10)
    memTotalBytes = (memMax && memMax !== 'max') ? parseInt(memMax, 10) : 0
  } else {
    // cgroup v1
    const v1Used = readCgroupFile('/sys/fs/cgroup/memory/memory.usage_in_bytes')
    const v1Limit = readCgroupFile('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    if (v1Used) memUsedBytes = parseInt(v1Used, 10)
    if (v1Limit) memTotalBytes = parseInt(v1Limit, 10)
  }

  // If memTotal looks like "max" (very large), fall back to /proc/meminfo
  if (memTotalBytes <= 0 || memTotalBytes > 128 * 1024 * 1024 * 1024) {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf-8')
      const m = meminfo.match(/MemTotal:\s+(\d+)\s+kB/)
      if (m) memTotalBytes = parseInt(m[1], 10) * 1024
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

function countProcCpus(): number {
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
  background: #000; min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: #fff; overflow: hidden;
}
.container { text-align: center; padding: 40px; position: relative; z-index: 1; }
.logo { width: 48px; height: 48px; margin: 0 auto 28px; opacity: 0.5; }
.logo svg { width: 100%; height: 100%; }
h1 { font-size: 20px; font-weight: 400; letter-spacing: -0.01em; margin-bottom: 6px; color: rgba(255,255,255,0.85); }
h1 span { font-weight: 600; }
.subtitle { font-size: 13px; color: rgba(255,255,255,0.3); margin-bottom: 36px; font-weight: 400; }
.search-box {
  display: flex; align-items: center; background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  padding: 10px 16px; width: 420px; max-width: 90vw; transition: all 0.2s ease;
}
.search-box:focus-within { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.15); }
.search-icon { width: 14px; height: 14px; margin-right: 10px; opacity: 0.3; flex-shrink: 0; }
.search-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: #fff; font-size: 14px; font-family: inherit;
}
.search-input::placeholder { color: rgba(255,255,255,0.25); }
.glow {
  position: fixed; width: 500px; height: 500px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%);
  top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;
}
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    </div>
    <h1><span>construct</span>.computer</h1>
    <p class="subtitle">Your AI-powered cloud workspace</p>
    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" class="search-input" placeholder="Search or enter URL" autofocus/>
    </div>
  </div>
  <script>
    const input = document.querySelector('.search-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const q = input.value.trim();
        window.location.href = q.includes('.') && !q.includes(' ') ? (q.startsWith('http') ? q : 'https://' + q) : 'https://search.brave.com/search?q=' + encodeURIComponent(q);
      }
    });
  </script>
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
      // --headed runs a real browser window on Xvfb (DISPLAY=:99) for max stealth —
      // headless Chromium is trivially detectable by anti-bot systems.
      await agentBrowser([
        'open', NEW_TAB_HTML,
        '--headed',
      ], 60_000)
      this.isLaunched = true

      // Set viewport
      await agentBrowser(['set', 'viewport', String(VIEWPORT.width), String(VIEWPORT.height)])

      console.log('[BrowserServer] agent-browser launched successfully')
    } catch (e) {
      console.error('[BrowserServer] Failed to launch agent-browser:', e)
      throw e
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
        setTimeout(() => this.broadcastTabs().catch(() => {}), 500)
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
