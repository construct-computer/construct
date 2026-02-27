import { spawn, type ChildProcess } from 'child_process'
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
  proc: ChildProcess
  ws: WebSocket
  alive: boolean
}

let nextId = 1

/**
 * TerminalServer spawns one `docker exec … bash` process per WebSocket
 * connection and pipes stdin/stdout between them.
 *
 * Key design decisions:
 *   - Plain `docker exec -i` (no PTY, no `script` wrapper).
 *   - LF→CRLF conversion is done here so xterm.js renders correctly.
 *   - An initial `\n` is sent 200 ms after spawn to flush the prompt.
 *   - stderr noise (job-control warnings) is silently dropped.
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

    const proc = spawn('docker', [
      'exec', '-i',
      '-u', 'sandbox',
      '-e', 'TERM=xterm-256color',
      '-e', 'HOME=/home/sandbox',
      '-e', 'USER=sandbox',
      '-w', '/home/sandbox/workspace',
      container,
      '/bin/bash', '-i',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const session: Session = { id, instanceId, proc, ws, alive: true }
    this.sessions.set(id, session)

    // ── stdout → client ────────────────────────────────────────────
    proc.stdout!.on('data', (buf: Buffer) => {
      if (!session.alive) return
      // Replace bare \n with \r\n so xterm.js does CR+LF
      const text = buf.toString().replace(/\r?\n/g, '\r\n')
      this.send(ws, { type: 'output', data: text })
    })

    // ── stderr → client (filtered per-line) ───────────────────────
    proc.stderr!.on('data', (buf: Buffer) => {
      if (!session.alive) return
      const text = buf.toString()
      // Strip individual noise lines but keep the rest (e.g. prompt)
      const filtered = text
        .split(/\r?\n/)
        .filter(line => !/cannot set terminal process group|no job control/i.test(line))
        .join('\n')
      if (!filtered.trim()) return
      const cleaned = filtered.replace(/\r?\n/g, '\r\n')
      this.send(ws, { type: 'output', data: cleaned })
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

    // ── client → stdin ─────────────────────────────────────────────
    ws.on('message', (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'input' && msg.data && proc.stdin) {
          proc.stdin.write(msg.data)
        }
        // resize is a no-op without a real PTY
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

    // Flush the shell prompt.  Bash in `-i` mode prints its PS1 to
    // stderr, which may arrive before the frontend wires its handler.
    // Wait for bash to fully start, then nudge with a newline.
    setTimeout(() => {
      if (session.alive && proc.stdin) {
        proc.stdin.write('\n')
      }
    }, 500)
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
    try { s.proc.kill('SIGKILL') } catch {}
    try { s.ws.close() } catch {}
    this.sessions.delete(id)
  }
}
