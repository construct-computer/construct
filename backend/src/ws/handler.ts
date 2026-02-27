import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { WebSocket as WsWebSocket } from 'ws'
import { EventEmitter } from 'events'
import {
  instances, browserClient, terminalServer, agentClient,
  addDesktopWindow, getDesktopWindows, toolToWindowType, desktopActionToWindowType,
  updateBrowserCache, browserStateCache,
} from '../services'
import type { AgentEvent } from '../agent-client'

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production'

/**
 * Adapter that wraps Bun's ServerWebSocket to look like a `ws` WebSocket.
 *
 * TerminalServer expects a `ws.WebSocket`-compatible object with:
 *   - .send(data)
 *   - .close()
 *   - .readyState  (compared against WsWebSocket.OPEN === 1)
 *   - .on('message', cb)
 *   - .on('close', cb)
 *   - .on('error', cb)
 *
 * Bun's ServerWebSocket has .send()/.close() but no EventEmitter. We bridge
 * events by emitting them from the Elysia ws hooks (message, close).
 */
class WsAdapter extends EventEmitter {
  private _open = true

  get readyState(): number {
    return this._open ? WsWebSocket.OPEN : WsWebSocket.CLOSED
  }

  send(data: string | Buffer | Uint8Array): void {
    if (!this._open || !this._sendFn) return
    try {
      this._sendFn(data)
    } catch {
      // Socket may have closed between the readyState check and the send
    }
  }

  close(): void {
    this._open = false
    this.emit('close')
  }

  /** Called by the Elysia ws hooks to feed events into the adapter. */
  _feedMessage(data: string | Buffer): void {
    this.emit('message', data)
  }

  _feedClose(): void {
    this._open = false
    this.emit('close')
  }

  _feedError(err: Error): void {
    this.emit('error', err)
  }

  private _sendFn: ((data: string | Buffer | Uint8Array) => void) | null = null

  /** Bind the real send function from the Elysia ws object. */
  _bindSend(fn: (data: string | Buffer | Uint8Array) => void): void {
    this._sendFn = fn
  }
}

/**
 * Verify JWT token and instance ownership.
 * Returns { user } or null.
 */
async function verifyWsAuth(
  jwtVerify: (token: string) => Promise<{ userId: string; username: string } | false>,
  token: string | undefined,
  instanceId: string,
): Promise<{ userId: string; username: string } | null> {
  if (!token) return null

  const payload = await jwtVerify(token)
  if (!payload || typeof payload === 'boolean') return null

  const user = payload as { userId: string; username: string }

  if (instanceId) {
    const instance = instances.get(instanceId)
    if (!instance || instance.userId !== user.userId) return null
  }

  return user
}

/**
 * All WebSocket routes as an Elysia plugin.
 * Uses Elysia's built-in .ws() which runs on Bun's native WebSocket.
 */
export const wsRoutes = new Elysia()
  .use(jwt({
    name: 'jwt',
    secret: JWT_SECRET,
  }))

  // ── Browser screencast stream ──
  .ws('/ws/browser/:instanceId', {
    async beforeHandle({ jwt, query, params, set }) {
      const q = query as Record<string, string | undefined>
      const user = await verifyWsAuth(
        (t) => jwt.verify(t) as Promise<{ userId: string; username: string } | false>,
        q.token,
        params.instanceId,
      )
      if (!user) {
        set.status = 401
        return 'Unauthorized'
      }
    },
    open(ws) {
      const instanceId = ws.data.params.instanceId
      if (!instances.has(instanceId)) {
        ws.close()
        return
      }

      console.log(`[WS] Browser stream connected for ${instanceId}`)

      // Send cached browser state so the frontend syncs immediately
      const cached = browserStateCache.get(instanceId)
      if (cached?.tabs) {
        try { ws.send(JSON.stringify({ type: 'tabs', tabs: cached.tabs })) } catch {}
      }
      if (cached?.url || cached?.title) {
        try { ws.send(JSON.stringify({ type: 'status', url: cached.url, title: cached.title })) } catch {}
      }

      const frameCallback = (frameBase64: string) => {
        try { ws.send(JSON.stringify({ type: 'frame', data: frameBase64 })) } catch {}
      }

      const messageCallback = (msg: Record<string, unknown>) => {
        try { ws.send(JSON.stringify(msg)) } catch {}

        // Cache browser state for future connections
        if (msg.type === 'tabs' && Array.isArray(msg.tabs)) {
          const tabs = msg.tabs as Array<{ id?: string; url?: string; title?: string; active?: boolean }>
          const active = tabs.find((t) => t.active) || tabs[0]
          updateBrowserCache(instanceId, {
            tabs: msg.tabs as unknown[],
            url: active?.url,
            title: active?.title,
            activeTabId: active?.id,
          })
        } else if (msg.type === 'status') {
          updateBrowserCache(instanceId, {
            url: msg.url as string | undefined,
            title: msg.title as string | undefined,
          })
        }
      }

      browserClient.startScreencast(instanceId, frameCallback)
      browserClient.onMessage(instanceId, messageCallback)

      // Store callbacks for cleanup on close
      ;(ws.data as any)._frameCallback = frameCallback
      ;(ws.data as any)._messageCallback = messageCallback
    },
    message(ws, rawMessage) {
      const instanceId = ws.data.params.instanceId
      try {
        const text = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
        const msg = JSON.parse(text) as Record<string, unknown>
        const browserMsg: Record<string, unknown> = { action: msg.type, ...msg }
        delete browserMsg.type
        browserClient.sendMessage(instanceId, browserMsg)
      } catch (e) {
        console.error(`[WS] Browser message parse error:`, e)
      }
    },
    close(ws) {
      const instanceId = ws.data.params.instanceId
      console.log(`[WS] Browser stream disconnected for ${instanceId}`)

      const frameCallback = (ws.data as any)._frameCallback
      const messageCallback = (ws.data as any)._messageCallback

      if (frameCallback) browserClient.stopScreencast(instanceId, frameCallback)
      if (messageCallback) browserClient.offMessage(instanceId, messageCallback)
    },
  })

  // ── Terminal I/O ──
  .ws('/ws/terminal/:instanceId', {
    async beforeHandle({ jwt, query, params, set }) {
      const q = query as Record<string, string | undefined>
      const user = await verifyWsAuth(
        (t) => jwt.verify(t) as Promise<{ userId: string; username: string } | false>,
        q.token,
        params.instanceId,
      )
      if (!user) {
        set.status = 401
        return 'Unauthorized'
      }
    },
    open(ws) {
      const instanceId = ws.data.params.instanceId
      if (!instances.has(instanceId)) {
        ws.close()
        return
      }

      console.log(`[WS] Terminal connected for ${instanceId}`)

      // Create a WsAdapter that the TerminalServer can treat as a ws.WebSocket
      const adapter = new WsAdapter()
      adapter._bindSend((data) => {
        try { ws.send(data) } catch {}
      })
      ;(ws.data as any)._adapter = adapter

      terminalServer.attachWebSocket(instanceId, adapter as unknown as WsWebSocket)
    },
    message(ws, rawMessage) {
      const adapter = (ws.data as any)._adapter as WsAdapter | undefined
      if (adapter) {
        const text = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
        adapter._feedMessage(text)
      }
    },
    close(ws) {
      const adapter = (ws.data as any)._adapter as WsAdapter | undefined
      if (adapter) {
        adapter._feedClose()
      }
    },
  })

  // ── Agent event stream + chat ──
  .ws('/ws/agent/:instanceId', {
    async beforeHandle({ jwt, query, params, set }) {
      const q = query as Record<string, string | undefined>
      const user = await verifyWsAuth(
        (t) => jwt.verify(t) as Promise<{ userId: string; username: string } | false>,
        q.token,
        params.instanceId,
      )
      if (!user) {
        set.status = 401
        return 'Unauthorized'
      }
    },
    open(ws) {
      const instanceId = ws.data.params.instanceId
      if (!instances.has(instanceId)) {
        ws.close()
        return
      }

      console.log(`[WS] Agent stream connected for ${instanceId}`)

      // Send current desktop state snapshot so the frontend can restore windows
      const openWindows = getDesktopWindows(instanceId)
      if (openWindows.length > 0) {
        try {
          ws.send(JSON.stringify({
            type: 'desktop_state',
            timestamp: Date.now(),
            data: { windows: openWindows },
          }))
        } catch {}
      }

      const eventCallback = (event: AgentEvent) => {
        try { ws.send(JSON.stringify(event)) } catch {}

        // Track desktop state so we can restore windows on frontend refresh.
        if (event.type === 'desktop_action') {
          const action = (event.data as { action?: string })?.action
          if (action) {
            const windowType = desktopActionToWindowType(action)
            if (windowType) addDesktopWindow(instanceId, windowType)
          }
        }

        // Also track tool_call events — if the agent uses a browser/terminal/editor
        // tool, that window is effectively "open".
        if (event.type === 'tool_call') {
          const tool = (event.data?.tool as string) || (event.data?.name as string) || ''
          const windowType = toolToWindowType(tool)
          if (windowType) addDesktopWindow(instanceId, windowType)

          // Handle desktop tool with action param
          if (tool === 'desktop') {
            const params = (event.data?.params ?? event.data?.args) as Record<string, unknown> | undefined
            const action = params?.action as string | undefined
            if (action) {
              const actionType = desktopActionToWindowType(action)
              if (actionType) addDesktopWindow(instanceId, actionType)
            }
          }
        }
      }

      agentClient.onEvent(instanceId, eventCallback)
      ;(ws.data as any)._eventCallback = eventCallback
    },
    message(ws, rawMessage) {
      const instanceId = ws.data.params.instanceId
      try {
        const text = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
        const msg = JSON.parse(text) as Record<string, unknown>
        if (msg.type === 'chat' && typeof msg.message === 'string') {
          const sessionKey = (typeof msg.session_key === 'string' ? msg.session_key : '') || 'ws_default'
          
          // Send thinking indicator
          try {
            ws.send(JSON.stringify({
              type: 'thinking',
              timestamp: Date.now(),
              data: { content: 'Processing your message...' },
            }))
          } catch {}
          
          // Send the message to the agent and relay the response back
          agentClient.sendMessage(instanceId, msg.message, sessionKey)
            .then((response) => {
              // Send the agent's response back to the frontend as a text_delta event
              try {
                ws.send(JSON.stringify({
                  type: 'text_delta',
                  timestamp: Date.now(),
                  data: { delta: response },
                }))
              } catch {}
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err)
              try {
                ws.send(JSON.stringify({
                  type: 'error',
                  timestamp: Date.now(),
                  data: { message },
                }))
              } catch {}
            })
        }
      } catch {
        // Ignore malformed messages
      }
    },
    close(ws) {
      const instanceId = ws.data.params.instanceId
      console.log(`[WS] Agent stream disconnected for ${instanceId}`)

      const eventCallback = (ws.data as any)._eventCallback
      if (eventCallback) {
        agentClient.offEvent(instanceId, eventCallback)
      }
    },
  })
