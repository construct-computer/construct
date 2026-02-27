import { spawn, execFile, type ChildProcess } from 'child_process'
import { WebSocket } from 'ws'
import { CONTAINER_PREFIX } from './constants'

/**
 * Messages from the frontend.
 */
interface ClientMessage {
  type: 'input' | 'resize' | 'ping'
  data?: string
  cols?: number
  rows?: number
}

interface Session {
  id: string
  instanceId: string
  container: string
  proc: ChildProcess
  ws: WebSocket
  alive: boolean
  /** Throttle timer for resize events */
  resizeTimer: ReturnType<typeof setTimeout> | null
  /** Pending resize dimensions (set during throttle window) */
  pendingResize: { cols: number; rows: number } | null
}

let nextId = 1

/**
 * TerminalServer spawns one `docker exec` + `script` process per WebSocket
 * connection, giving bash a real PTY inside the container.
 *
 * Key design decisions:
 *   - Uses `script -qc` to allocate a PTY inside the container.
 *   - PTY handles echo, line editing, CRLF, colors — no manual conversion.
 *   - All output (stdout+stderr) flows through the PTY to stdout.
 *   - Resize uses `stty -F /dev/pts/N rows R cols C` on the tmux client's PTY
 *     via a separate `docker exec`, which triggers SIGWINCH so tmux redraws.
 */
export class TerminalServer {
  private sessions = new Map<string, Session>()

  constructor() {
    console.log('[TerminalServer] Initialized')
  }

  /**
   * Attach a WebSocket to a new bash session in the given container.
   */
  attachWebSocket(instanceId: string, ws: WebSocket): void {
    const id = String(nextId++)
    const container = `${CONTAINER_PREFIX}${instanceId}`

    console.log(`[Terminal] #${id} starting for ${container}`)

    // Attach to the shared tmux session inside the container.
    // IMPORTANT: Must run as 'sandbox' user (UID 1001) because the tmux
    // session is created by supervisor as sandbox. Running as root would
    // create a separate tmux "main" in root's socket namespace, so agent
    // commands (sent via tmux send-keys as sandbox) would never appear.
    const proc = spawn('docker', [
      'exec', '-i',
      '-u', 'sandbox',
      '-e', 'TERM=xterm-256color',
      '-e', 'HOME=/home/sandbox',
      '-e', 'USER=sandbox',
      container,
      'script', '-qc',
      'tmux attach-session -t main 2>/dev/null || (tmux new-session -d -s main -c /home/sandbox/workspace && tmux attach-session -t main)',
      '/dev/null',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const session: Session = {
      id, instanceId, container, proc, ws,
      alive: true,
      resizeTimer: null,
      pendingResize: null,
    }
    this.sessions.set(id, session)

    // ── stdout → client (PTY output, already has proper CRLF) ──────
    proc.stdout!.on('data', (buf: Buffer) => {
      if (!session.alive) return
      this.send(ws, { type: 'output', data: buf.toString() })
    })

    // ── stderr → client (minimal with PTY, just relay) ─────────────
    proc.stderr!.on('data', (buf: Buffer) => {
      if (!session.alive) return
      const text = buf.toString()
      if (!text.trim()) return
      this.send(ws, { type: 'output', data: text })
    })

    // ── process lifecycle ──────────────────────────────────────────
    proc.on('error', (err) => {
      console.error(`[Terminal] #${id} error:`, err.message)
      this.send(ws, { type: 'error', data: err.message })
    })

    proc.on('exit', (code) => {
      console.log(`[Terminal] #${id} exited (${code})`)
      this.send(ws, { type: 'exit', code: code ?? 0 })
      this.cleanup(id)
    })

    // ── client → stdin + resize ────────────────────────────────────
    ws.on('message', (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'input' && msg.data && proc.stdin) {
          proc.stdin.write(msg.data)
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          this.handleResize(session, msg.cols, msg.rows)
        }
      } catch { /* ignore bad frames */ }
    })

    ws.on('close', () => {
      if (session.alive) {
        console.log(`[Terminal] #${id} client disconnected`)
      }
      this.cleanup(id)
    })

    ws.on('error', () => {})

    // ── ready handshake ────────────────────────────────────────────
    this.send(ws, { type: 'ready' })
  }

  /** Kill all sessions for an instance (container teardown). */
  destroyInstance(instanceId: string): void {
    for (const [id, s] of this.sessions) {
      if (s.instanceId === instanceId) this.cleanup(id)
    }
  }

  /** Write to the first session for an instance (for AI agent). */
  write(instanceId: string, data: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.instanceId === instanceId && s.alive && s.proc.stdin) {
        s.proc.stdin.write(data)
        return true
      }
    }
    return false
  }

  getStats() { return { activeSessions: this.sessions.size } }

  shutdown(): void {
    for (const id of [...this.sessions.keys()]) this.cleanup(id)
  }

  // ── resize handling ──────────────────────────────────────────────

  /**
   * Handle a resize event from the frontend.
   *
   * Resizing a PTY allocated by `script` from the outside is done by:
   *   1. Finding the tmux client's PTY device (e.g. /dev/pts/1)
   *   2. Running `stty -F /dev/pts/N rows R cols C` in the container
   * This updates the kernel winsize struct, which triggers SIGWINCH
   * so tmux (and any child processes) detect the new dimensions.
   *
   * Throttled to avoid spawning too many `docker exec` processes
   * during rapid window resizing.
   */
  private handleResize(session: Session, cols: number, rows: number): void {
    session.pendingResize = { cols, rows }

    if (session.resizeTimer) return // already throttled

    session.resizeTimer = setTimeout(() => {
      session.resizeTimer = null
      const pending = session.pendingResize
      if (!pending || !session.alive) return
      session.pendingResize = null

      this.doResize(session.container, pending.cols, pending.rows)
    }, 150) // throttle to max ~7 resizes/sec
  }

  private doResize(container: string, cols: number, rows: number): void {
    // Find the tmux client's PTY and resize it in one shot.
    // `tmux list-clients -F '#{client_tty}'` gives e.g. "/dev/pts/1".
    // Then `stty -F <pty> rows R cols C` resizes the kernel winsize.
    const script =
      `pty=$(tmux list-clients -F '#{client_tty}' 2>/dev/null | head -1); ` +
      `[ -n "$pty" ] && stty -F "$pty" rows ${rows} cols ${cols} 2>/dev/null`

    execFile('docker', [
      'exec', '-u', 'sandbox',
      '-e', 'HOME=/home/sandbox',
      container,
      'bash', '-c', script,
    ], { timeout: 3000 }, (err) => {
      if (err) {
        // Non-critical — resize just won't take effect this time.
        // Common during container startup when tmux isn't ready yet.
      }
    })
  }

  // ── helpers ──────────────────────────────────────────────────────

  private send(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)) } catch {}
    }
  }

  private cleanup(id: string) {
    const s = this.sessions.get(id)
    if (!s) return
    s.alive = false
    if (s.resizeTimer) clearTimeout(s.resizeTimer)
    try { s.proc.kill('SIGKILL') } catch {}
    try { s.ws.close() } catch {}
    this.sessions.delete(id)
  }
}
