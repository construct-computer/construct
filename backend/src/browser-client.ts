import { WebSocket } from 'ws'
import type { ContainerManager } from './container-manager'

interface BrowserMessage {
  type: string
  [key: string]: unknown
}

interface BrowserSession {
  instanceId: string
  ws: WebSocket | null
  port: number
  connected: boolean
  reconnectTimer: NodeJS.Timeout | null
  frameCallbacks: Set<(frameBase64: string) => void>
  messageCallbacks: Set<(message: BrowserMessage) => void>
  pendingRequests: Map<string, { resolve: (data: BrowserMessage) => void; reject: (err: Error) => void }>
  requestCounter: number
}

/**
 * BrowserClient connects to browser servers running inside containers.
 * Each container runs its own Playwright browser, and this client
 * proxies requests and frame streams from the orchestrator.
 */
export class BrowserClient {
  private sessions = new Map<string, BrowserSession>()
  private containerManager: ContainerManager

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager
  }

  async initialize(): Promise<void> {
    console.log('[BrowserClient] Initialized (connects to in-container browsers)')
  }

  async createSession(instanceId: string): Promise<void> {
    const container = this.containerManager.getContainer(instanceId)
    if (!container) {
      throw new Error(`Container not found for instance ${instanceId}`)
    }

    const session: BrowserSession = {
      instanceId,
      ws: null,
      port: container.ports.browser,
      connected: false,
      reconnectTimer: null,
      frameCallbacks: new Set(),
      messageCallbacks: new Set(),
      pendingRequests: new Map(),
      requestCounter: 0,
    }

    this.sessions.set(instanceId, session)

    // Connect to container's browser server with retry logic
    await this.connectWithRetry(instanceId, 30000) // 30s timeout for container startup
  }

  private async connectWithRetry(instanceId: string, timeoutMs: number): Promise<void> {
    const session = this.sessions.get(instanceId)
    if (!session) return

    const startTime = Date.now()
    const retryInterval = 1000 // 1 second between retries

    while (Date.now() - startTime < timeoutMs) {
      try {
        await this.connect(instanceId)
        console.log(`[BrowserClient] Connected to browser for ${instanceId}`)
        return
      } catch (error) {
        // Container's browser server might not be ready yet
        console.log(`[BrowserClient] Waiting for browser server in ${instanceId}...`)
        await new Promise(resolve => setTimeout(resolve, retryInterval))
      }
    }

    throw new Error(`Failed to connect to browser server for ${instanceId} within ${timeoutMs}ms`)
  }

  private async connect(instanceId: string): Promise<void> {
    const session = this.sessions.get(instanceId)
    if (!session) return

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${session.port}`)
      
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timeout'))
      }, 5000)

      ws.on('open', () => {
        clearTimeout(timeout)
        session.ws = ws
        session.connected = true
        resolve()
      })

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          this.handleMessage(instanceId, msg)
        } catch (e) {
          console.error(`[BrowserClient] Message parse error for ${instanceId}:`, e)
        }
      })

      ws.on('close', () => {
        session.connected = false
        session.ws = null
        console.log(`[BrowserClient] Disconnected from ${instanceId}`)
        
        // Only reconnect if session still exists (not destroyed)
        if (this.sessions.has(instanceId)) {
          this.scheduleReconnect(instanceId)
        }
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        console.error(`[BrowserClient] Connection error for ${instanceId}:`, error.message)
        reject(error)
      })
    })
  }

  private scheduleReconnect(instanceId: string): void {
    const session = this.sessions.get(instanceId)
    if (!session || session.reconnectTimer) return

    session.reconnectTimer = setTimeout(async () => {
      session.reconnectTimer = null
      try {
        await this.connect(instanceId)
        console.log(`[BrowserClient] Reconnected to ${instanceId}`)
      } catch (e) {
        // Will be rescheduled by close handler
      }
    }, 500) // Fast reconnect
  }

  // Wait for an active connection, with timeout
  private async waitForConnection(instanceId: string, timeoutMs = 5000): Promise<BrowserSession> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const session = this.sessions.get(instanceId)
      if (session?.ws && session.connected) return session
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error('Not connected to browser (timed out waiting for reconnect)')
  }

  private handleMessage(instanceId: string, msg: BrowserMessage): void {
    const session = this.sessions.get(instanceId)
    if (!session) return

    switch (msg.type) {
      case 'frame':
        // Forward base64 frame string directly to all registered callbacks
        // (no decode/re-encode - pass base64 all the way through to frontend)
        const frameBase64 = msg.data as string
        for (const callback of session.frameCallbacks) {
          try {
            callback(frameBase64)
          } catch (e) {
            console.error(`[BrowserClient] Frame callback error:`, e)
          }
        }
        break

      case 'tabs':
      case 'status':
      case 'activeTab':
      case 'stats':
      case 'ack':
      case 'error':
        // Forward these messages to all registered client callbacks
        for (const callback of session.messageCallbacks) {
          try {
            callback(msg)
          } catch (e) {
            console.error(`[BrowserClient] Message callback error:`, e)
          }
        }
        
        // Also resolve pending requests for backwards compatibility with REST API
        if (msg.type === 'tabs' || msg.type === 'status') {
          for (const [id, pending] of session.pendingRequests) {
            pending.resolve(msg)
            session.pendingRequests.delete(id)
            break
          }
        } else if (msg.type === 'ack') {
          for (const [id, pending] of session.pendingRequests) {
            pending.resolve({ type: 'ack', success: true })
            session.pendingRequests.delete(id)
            break
          }
        } else if (msg.type === 'error') {
          for (const [id, pending] of session.pendingRequests) {
            pending.reject(new Error((msg.message as string) || 'Action failed'))
            session.pendingRequests.delete(id)
            break
          }
        }
        break
    }
  }

  private async sendAndWait(instanceId: string, message: BrowserMessage, timeoutMs = 30000): Promise<BrowserMessage> {
    const session = await this.waitForConnection(instanceId)

    return new Promise((resolve, reject) => {
      const requestId = `req-${++session.requestCounter}`

      const timeout = setTimeout(() => {
        session.pendingRequests.delete(requestId)
        reject(new Error('Request timeout'))
      }, timeoutMs)

      session.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout)
          resolve(data)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        },
      })

      session.ws!.send(JSON.stringify(message))
    })
  }

  // Start receiving frames (base64 strings)
  startScreencast(instanceId: string, onFrame: (frameBase64: string) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) {
      console.warn(`[BrowserClient] startScreencast called but no session for ${instanceId}`)
      return
    }

    session.frameCallbacks.add(onFrame)
    console.log(`[BrowserClient] Screencast started for ${instanceId}`)
  }

  // Stop receiving frames for a specific callback
  stopScreencast(instanceId: string, onFrame?: (frameBase64: string) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) return

    if (onFrame) {
      session.frameCallbacks.delete(onFrame)
      console.log(`[BrowserClient] Screencast listener removed for ${instanceId} (${session.frameCallbacks.size} remaining)`)
    } else {
      session.frameCallbacks.clear()
      console.log(`[BrowserClient] All screencast listeners cleared for ${instanceId}`)
    }
  }

  // Register a callback to receive all non-frame messages (tabs, ack, error, activeTab, status)
  onMessage(instanceId: string, callback: (msg: BrowserMessage) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) {
      console.warn(`[BrowserClient] onMessage called but no session for ${instanceId}`)
      return
    }
    session.messageCallbacks.add(callback)
  }

  // Unregister a message callback
  offMessage(instanceId: string, callback: (msg: BrowserMessage) => void): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    session.messageCallbacks.delete(callback)
  }

  // Send a raw message to the container's browser server
  async sendMessage(instanceId: string, message: Record<string, unknown>): Promise<void> {
    const session = await this.waitForConnection(instanceId)
    session.ws!.send(JSON.stringify(message))
  }

  async destroySession(instanceId: string): Promise<void> {
    const session = this.sessions.get(instanceId)
    if (!session) return

    console.log(`[BrowserClient] Destroying session for ${instanceId}`)

    // Clear reconnect timer
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
    }

    // Clear callbacks
    session.frameCallbacks.clear()
    session.messageCallbacks.clear()

    // Reject pending requests
    for (const pending of session.pendingRequests.values()) {
      pending.reject(new Error('Session destroyed'))
    }
    session.pendingRequests.clear()

    // Close WebSocket
    if (session.ws) {
      session.ws.close()
    }

    this.sessions.delete(instanceId)
  }

  getStats(): { activeSessions: number } {
    return {
      activeSessions: this.sessions.size,
    }
  }

  async shutdown(): Promise<void> {
    console.log('[BrowserClient] Shutting down...')

    for (const instanceId of this.sessions.keys()) {
      await this.destroySession(instanceId)
    }

    console.log('[BrowserClient] Shutdown complete')
  }
}
