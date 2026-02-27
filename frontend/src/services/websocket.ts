import { STORAGE_KEYS } from '@/lib/constants';

// Get WebSocket base URL
function getWsBaseUrl(): string {
  const isDev = import.meta.env.DEV;
  const backendHost = isDev ? 'localhost:3000' : window.location.host;
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${backendHost}`;
}

/**
 * Browser WebSocket client - receives frame data from container:9222
 */
class BrowserWSClient {
  private ws: WebSocket | null = null;
  private instanceId: string | null = null;
  private frameHandler: ((frameBase64: string) => void) | null = null;
  private messageHandler: ((msg: Record<string, unknown>) => void) | null = null;
  private connectionHandler: ((connected: boolean) => void) | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect(instanceId: string) {
    if (this.ws?.readyState === WebSocket.OPEN && this.instanceId === instanceId) {
      return;
    }

    this.disconnect();
    this.instanceId = instanceId;

    const token = localStorage.getItem(STORAGE_KEYS.token);
    const url = `${getWsBaseUrl()}/ws/browser/${instanceId}?token=${encodeURIComponent(token || '')}`;
    
    console.log('[BrowserWS] Connecting to', url);
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[BrowserWS] Connected');
        this.connectionHandler?.(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'frame' && typeof msg.data === 'string') {
            // Frame data arrives as base64 string in JSON
            this.frameHandler?.(msg.data);
          } else {
            // Other JSON messages (tabs, status, etc.)
            this.messageHandler?.(msg);
          }
        } catch (e) {
          console.error('[BrowserWS] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[BrowserWS] Disconnected');
        this.connectionHandler?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[BrowserWS] Error', error);
      };
    } catch (error) {
      console.error('[BrowserWS] Failed to connect', error);
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.instanceId = null;
  }

  private scheduleReconnect() {
    if (this.instanceId && !this.reconnectTimeout) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        if (this.instanceId) {
          this.connect(this.instanceId);
        }
      }, 2000);
    }
  }

  sendAction(action: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(action));
    }
  }

  onFrame(handler: (frameBase64: string) => void) {
    this.frameHandler = handler;
  }

  onMessage(handler: (msg: Record<string, unknown>) => void) {
    this.messageHandler = handler;
  }

  onConnection(handler: (connected: boolean) => void) {
    this.connectionHandler = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Terminal WebSocket client - bidirectional I/O with container shell.
 *
 * Protocol (JSON frames):
 *   server → client:  { type: "ready" }
 *                      { type: "output", data: "..." }
 *                      { type: "exit",   code: 0 }
 *                      { type: "error",  data: "..." }
 *   client → server:  { type: "input",  data: "..." }
 */
class TerminalWSClient {
  private ws: WebSocket | null = null;
  private instanceId: string | null = null;
  private outputHandler: ((data: string) => void) | null = null;
  private connectionHandler: ((connected: boolean) => void) | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect(instanceId: string) {
    // Already connected to this instance
    if (this.ws?.readyState === WebSocket.OPEN && this.instanceId === instanceId) {
      return;
    }

    this.disconnect();
    this.instanceId = instanceId;

    const token = localStorage.getItem(STORAGE_KEYS.token);
    const url = `${getWsBaseUrl()}/ws/terminal/${instanceId}?token=${encodeURIComponent(token || '')}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[TerminalWS] Connected');
        this.connectionHandler?.(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;

          switch (msg.type) {
            case 'output':
              if (typeof msg.data === 'string') {
                this.outputHandler?.(msg.data);
              }
              break;
            case 'ready':
              console.log('[TerminalWS] Shell ready');
              break;
            case 'exit':
              console.log('[TerminalWS] Shell exited', msg.code);
              break;
            case 'error':
              console.error('[TerminalWS] Shell error:', msg.data);
              break;
          }
        } catch { /* ignore non-JSON */ }
      };

      this.ws.onclose = () => {
        console.log('[TerminalWS] Disconnected');
        this.connectionHandler?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {};
    } catch {
      console.error('[TerminalWS] Failed to connect');
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.instanceId = null;
  }

  private scheduleReconnect() {
    if (this.instanceId && !this.reconnectTimeout) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        if (this.instanceId) this.connect(this.instanceId);
      }, 2000);
    }
  }

  sendInput(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  resize(cols: number, rows: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  onOutput(handler: (data: string) => void) {
    this.outputHandler = handler;
  }

  onConnection(handler: (connected: boolean) => void) {
    this.connectionHandler = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Agent WebSocket client - receives events and sends chat messages
 */
export interface AgentEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

class AgentWSClient {
  private ws: WebSocket | null = null;
  private instanceId: string | null = null;
  private eventHandler: ((event: AgentEvent) => void) | null = null;
  private connectionHandler: ((connected: boolean) => void) | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect(instanceId: string) {
    if (this.ws?.readyState === WebSocket.OPEN && this.instanceId === instanceId) {
      return;
    }

    this.disconnect();
    this.instanceId = instanceId;

    const token = localStorage.getItem(STORAGE_KEYS.token);
    const url = `${getWsBaseUrl()}/ws/agent/${instanceId}?token=${encodeURIComponent(token || '')}`;
    
    console.log('[AgentWS] Connecting to', url);
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[AgentWS] Connected');
        this.connectionHandler?.(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as AgentEvent;
          this.eventHandler?.(msg);
        } catch (e) {
          console.error('[AgentWS] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[AgentWS] Disconnected');
        this.connectionHandler?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[AgentWS] Error', error);
      };
    } catch (error) {
      console.error('[AgentWS] Failed to connect', error);
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.instanceId = null;
  }

  private scheduleReconnect() {
    if (this.instanceId && !this.reconnectTimeout) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        if (this.instanceId) {
          this.connect(this.instanceId);
        }
      }, 2000);
    }
  }

  sendChat(message: string, sessionKey: string = 'ws_default') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', message, session_key: sessionKey }));
    }
  }

  onEvent(handler: (event: AgentEvent) => void) {
    this.eventHandler = handler;
  }

  onConnection(handler: (connected: boolean) => void) {
    this.connectionHandler = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instances
export const browserWS = new BrowserWSClient();
export const terminalWS = new TerminalWSClient();
export const agentWS = new AgentWSClient();

// Legacy export for compatibility (not used anymore)
export const wsClient = {
  connect: () => {},
  disconnect: () => {},
  isConnected: () => false,
  onEvent: () => () => {},
  onConnection: () => () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  sendAgentMessage: () => {},
  sendTerminalInput: () => {},
  send: () => {},
};
