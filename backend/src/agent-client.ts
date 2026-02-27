import { WebSocket } from 'ws'

// Agent event types
export interface AgentEvent {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

// Agent status from the boneclaw /status endpoint
export interface AgentStatus {
  running: boolean
  model: string
  provider: string
  session_count: number
  uptime_seconds: number
}

// Agent config for BYOK
export interface AgentConfig {
  openrouter_api_key?: string
  telegram_bot_token?: string
  model?: string
}

interface AgentSession {
  instanceId: string
  port: number
  ws: WebSocket | null
  eventCallbacks: Set<(event: AgentEvent) => void>
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number
}

/**
 * AgentClient manages WebSocket connections to boneclaw agents running
 * inside Docker containers. It connects to each agent's /events endpoint
 * and relays events to registered callbacks (which forward them to the frontend).
 */
export class AgentClient {
  private sessions = new Map<string, AgentSession>()
  private maxReconnectAttempts = 30
  private baseReconnectDelay = 1000

  /**
   * Create a new agent session and connect to the agent's WebSocket.
   * Preserves any existing event callbacks (e.g., from frontend WS connections
   * that remain open across a reboot).
   */
  createSession(instanceId: string, port: number): void {
    // Preserve callbacks from the old session before tearing it down.
    const existing = this.sessions.get(instanceId)
    const preservedCallbacks = existing
      ? new Set(existing.eventCallbacks)
      : new Set<(event: AgentEvent) => void>()

    // Clean up WS and timers (but we already saved the callbacks).
    if (existing) {
      if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer)
      if (existing.ws) {
        existing.ws.removeAllListeners()
        existing.ws.close()
      }
      this.sessions.delete(instanceId)
    }

    const session: AgentSession = {
      instanceId,
      port,
      ws: null,
      eventCallbacks: preservedCallbacks,
      reconnectTimer: null,
      reconnectAttempts: 0,
    }

    this.sessions.set(instanceId, session)
    this.connect(session)
  }

  /**
   * Destroy an agent session and close the WebSocket.
   */
  destroySession(instanceId: string): void {
    const session = this.sessions.get(instanceId)
    if (!session) return

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
    }
    if (session.ws) {
      session.ws.removeAllListeners()
      session.ws.close()
    }
    session.eventCallbacks.clear()
    this.sessions.delete(instanceId)
  }

  /**
   * Send a chat message to the agent.
   * Returns the agent's response text.
   */
  async sendMessage(instanceId: string, message: string, sessionKey?: string): Promise<string> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/chat`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_key: sessionKey || 'http_default',
      }),
      signal: AbortSignal.timeout(300_000), // 5 minute timeout for long agent tasks
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Agent chat failed (${res.status}): ${body}`)
    }

    const data = await res.json() as { response: string; session_key: string }
    return data.response
  }

  /**
   * Get the agent's current status.
   */
  async getStatus(instanceId: string): Promise<AgentStatus> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    try {
      const url = `http://127.0.0.1:${session.port}/status`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Status request failed: ${res.status}`)
      return await res.json() as AgentStatus
    } catch {
      return {
        running: false,
        model: '',
        provider: '',
        session_count: 0,
        uptime_seconds: 0,
      }
    }
  }

  /**
   * Get conversation history for a session.
   */
  async getHistory(instanceId: string, sessionKey: string = 'ws_default'): Promise<{ session_key: string; messages: Array<Record<string, unknown>> }> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/history?session_key=${encodeURIComponent(sessionKey)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`History request failed: ${res.status}`)
    return await res.json() as { session_key: string; messages: Array<Record<string, unknown>> }
  }

  /**
   * Register a callback for agent events.
   */
  onEvent(instanceId: string, callback: (event: AgentEvent) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    session.eventCallbacks.add(callback)
  }

  /**
   * Unregister an event callback.
   */
  offEvent(instanceId: string, callback: (event: AgentEvent) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    session.eventCallbacks.delete(callback)
  }

  /**
   * Check if an agent session exists and is connected.
   */
  isConnected(instanceId: string): boolean {
    const session = this.sessions.get(instanceId)
    return session?.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Get session count.
   */
  get sessionCount(): number {
    return this.sessions.size
  }

  /**
   * Destroy all sessions.
   */
  shutdown(): void {
    for (const instanceId of this.sessions.keys()) {
      this.destroySession(instanceId)
    }
  }

  // --- Private methods ---

  private connect(session: AgentSession): void {
    const url = `ws://127.0.0.1:${session.port}/events`

    try {
      // golang.org/x/net/websocket requires an Origin header for the handshake.
      const ws = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${session.port}` } })

      ws.on('open', () => {
        console.log(`[AgentClient] Connected to agent for instance ${session.instanceId}`)
        session.reconnectAttempts = 0
      })

      ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString()) as AgentEvent
          for (const callback of session.eventCallbacks) {
            try {
              callback(event)
            } catch (err) {
              console.error('[AgentClient] Event callback error:', err)
            }
          }
        } catch {
          // Ignore malformed messages.
        }
      })

      ws.on('close', () => {
        console.log(`[AgentClient] Disconnected from agent for instance ${session.instanceId}`)
        session.ws = null
        this.scheduleReconnect(session)
      })

      ws.on('error', (err: Error) => {
        // Suppress connection refused errors during reconnection — agent may still be starting.
        if (session.reconnectAttempts > 0) return
        console.error(`[AgentClient] WebSocket error for ${session.instanceId}:`, err.message)
      })

      session.ws = ws
    } catch {
      this.scheduleReconnect(session)
    }
  }

  private scheduleReconnect(session: AgentSession): void {
    // Don't reconnect if session was destroyed.
    if (!this.sessions.has(session.instanceId)) return

    if (session.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[AgentClient] Max reconnect attempts reached for ${session.instanceId}`)
      return
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(1.5, session.reconnectAttempts),
      30000
    )
    session.reconnectAttempts++

    session.reconnectTimer = setTimeout(() => {
      if (this.sessions.has(session.instanceId)) {
        this.connect(session)
      }
    }, delay)
  }
}
