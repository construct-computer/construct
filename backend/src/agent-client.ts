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
  tinyfish_api_key?: string
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
 * Handler for service requests from boneclaw agent tools.
 * Receives the instanceId, service name, action, and params;
 * returns a result that gets sent back to the agent over WS.
 */
export type ServiceRequestHandler = (
  instanceId: string,
  service: string,
  action: string,
  params: Record<string, unknown>,
) => Promise<{ success: boolean; data?: unknown; error?: string }>

/**
 * AgentClient manages WebSocket connections to boneclaw agents running
 * inside Docker containers. It connects to each agent's /events endpoint
 * and relays events to registered callbacks (which forward them to the frontend).
 */
export class AgentClient {
  private sessions = new Map<string, AgentSession>()
  private maxReconnectAttempts = 30
  private baseReconnectDelay = 1000
  private serviceRequestHandler: ServiceRequestHandler | null = null

  /**
   * Register a handler for service requests from the agent.
   * Called during backend initialization to wire up services like DriveService.
   */
  setServiceRequestHandler(handler: ServiceRequestHandler): void {
    this.serviceRequestHandler = handler
  }

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
   * Abort the agent's currently running loop.
   */
  async abortRun(instanceId: string): Promise<boolean> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/abort`
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) return false
    const data = await res.json() as { aborted: boolean }
    return data.aborted
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
   * List all chat sessions for an instance.
   */
  async getChatSessions(instanceId: string): Promise<{ sessions: Array<Record<string, unknown>>; active_key: string }> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/sessions`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sessions request failed: ${res.status}`)
    return await res.json() as { sessions: Array<Record<string, unknown>>; active_key: string }
  }

  /**
   * Create a new chat session.
   */
  async createChatSession(instanceId: string, title?: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/sessions`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`Create session failed: ${res.status}`)
    return await res.json() as Record<string, unknown>
  }

  /**
   * Delete a chat session.
   */
  async deleteChatSession(instanceId: string, sessionKey: string): Promise<{ ok: boolean; active_key: string }> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/sessions/${encodeURIComponent(sessionKey)}`
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error((body.error as string) || `Delete session failed: ${res.status}`)
    }
    return await res.json() as { ok: boolean; active_key: string }
  }

  /**
   * Rename a chat session.
   */
  async renameChatSession(instanceId: string, sessionKey: string, title: string): Promise<void> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/sessions/${encodeURIComponent(sessionKey)}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`Rename session failed: ${res.status}`)
  }

  /**
   * Switch the active chat session.
   */
  async activateChatSession(instanceId: string, sessionKey: string): Promise<void> {
    const session = this.sessions.get(instanceId)
    if (!session) throw new Error(`No agent session for instance ${instanceId}`)

    const url = `http://127.0.0.1:${session.port}/sessions/${encodeURIComponent(sessionKey)}/activate`
    const res = await fetch(url, { method: 'PUT' })
    if (!res.ok) throw new Error(`Activate session failed: ${res.status}`)
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

          // Intercept service_request events — these are from agent tools
          // requesting backend services (e.g. Google Drive). Handle them
          // and send the response back; don't forward to frontend callbacks.
          if (event.type === 'service_request') {
            this.handleServiceRequest(session, event as unknown as {
              type: 'service_request'
              requestId: string
              service: string
              action: string
              params: Record<string, unknown>
            })
            return
          }

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

  /**
   * Handle a service_request from the agent. Dispatches to the registered
   * handler and sends the result back over the WS connection.
   */
  private async handleServiceRequest(
    session: AgentSession,
    request: { type: 'service_request'; requestId: string; service: string; action: string; params: Record<string, unknown> },
  ): Promise<void> {
    let result: { success: boolean; data?: unknown; error?: string }

    if (!this.serviceRequestHandler) {
      result = { success: false, error: 'No service request handler registered' }
    } else {
      try {
        result = await this.serviceRequestHandler(session.instanceId, request.service, request.action, request.params)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[AgentClient] Service request error (${request.service}.${request.action}):`, message)
        result = { success: false, error: message }
      }
    }

    // Send the response back to boneclaw over the same WS
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.send(JSON.stringify({
          type: 'service_response',
          requestId: request.requestId,
          success: result.success,
          data: result.data,
          error: result.error,
        }))
      } catch (err) {
        console.error('[AgentClient] Failed to send service response:', err)
      }
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
