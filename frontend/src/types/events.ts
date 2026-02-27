import type { WindowType } from './window';

// Server -> Client events
export type ServerEvent =
  | { type: 'connected'; connectionId: string }
  | { type: 'error'; message: string }
  | { type: 'agent:status'; agentId: string; status: string }
  | { type: 'agent:heartbeat'; agentId: string; status: string; uptime: number }
  // Agent events
  | { type: 'agent:started'; agentId: string; config: { name: string; model: string } }
  | { type: 'agent:thinking'; agentId: string; content: string }
  | { type: 'agent:text'; agentId: string; content: string }
  | { type: 'agent:text_delta'; agentId: string; content: string }
  | { type: 'agent:tool_start'; agentId: string; tool: string; args: Record<string, unknown>; callId: string }
  | { type: 'agent:tool_end'; agentId: string; tool: string; result: unknown; callId: string; success: boolean }
  | { type: 'agent:error'; agentId: string; error: string }
  | { type: 'agent:complete'; agentId: string }
  // Window events
  | { type: 'window:open'; agentId: string; windowId: string; windowType: WindowType; title: string }
  | { type: 'window:close'; agentId: string; windowId: string }
  | { type: 'window:focus'; agentId: string; windowId: string }
  | { type: 'window:update'; agentId: string; windowId: string; data: unknown }
  // Browser events
  | { type: 'browser:navigating'; agentId: string; url: string }
  | { type: 'browser:navigated'; agentId: string; url: string; title: string }
  | { type: 'browser:screenshot'; agentId: string; data: string }
  | { type: 'browser:snapshot'; agentId: string; snapshot: string; refs: Record<string, unknown> }
  | { type: 'browser:action'; agentId: string; action: string; target?: string }
  | { type: 'browser:frame'; agentId: string; data: string; metadata: BrowserFrameMetadata }
  // Terminal events
  | { type: 'terminal:command'; agentId: string; command: string; cwd: string }
  | { type: 'terminal:output'; agentId: string; data: string }
  | { type: 'terminal:exit'; agentId: string; code: number }
  // File system events
  | { type: 'fs:read'; agentId: string; path: string }
  | { type: 'fs:write'; agentId: string; path: string }
  | { type: 'fs:edit'; agentId: string; path: string };

// Client -> Server events
export type ClientEvent =
  | { type: 'subscribe'; agentId: string }
  | { type: 'unsubscribe'; agentId: string }
  | { type: 'agent:message'; agentId: string; content: string }
  | { type: 'terminal:input'; agentId: string; data: string }
  | { type: 'browser:input'; agentId: string; eventType: 'mouse' | 'keyboard' | 'touch'; payload: unknown }
  | { type: 'ping' };

export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}
