// WebSocket event types for real-time communication

// Server -> Client events
export type ServerEvent =
  | { type: 'connected'; connectionId: string }
  | { type: 'error'; message: string }
  | { type: 'agent:status'; agentId: string; status: string }
  | { type: 'agent:heartbeat'; agentId: string; status: string; uptime: number }
  // Agent events (from BoneClaw)
  | { type: 'agent:started'; agentId: string; config: { name: string; model: string } }
  | { type: 'agent:thinking'; agentId: string; content: string }
  | { type: 'agent:text'; agentId: string; content: string }
  | { type: 'agent:text_delta'; agentId: string; content: string }
  | { type: 'agent:tool_start'; agentId: string; tool: string; args: Record<string, unknown>; callId: string }
  | { type: 'agent:tool_end'; agentId: string; tool: string; result: unknown; callId: string; success: boolean }
  | { type: 'agent:error'; agentId: string; error: string }
  | { type: 'agent:complete'; agentId: string }
  // Window events (for frontend rendering)
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

export type WindowType = 'browser' | 'terminal' | 'files' | 'editor' | 'chat';

export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}

// Convert BoneClaw event to server event
export function convertAgentEvent(agentId: string, event: Record<string, unknown>): ServerEvent | null {
  const eventType = event.type as string;
  
  switch (eventType) {
    case 'agent:started':
      return {
        type: 'agent:started',
        agentId,
        config: event.config as { name: string; model: string },
      };
    case 'agent:thinking':
      return { type: 'agent:thinking', agentId, content: event.content as string };
    case 'agent:text':
      return { type: 'agent:text', agentId, content: event.content as string };
    case 'agent:text_delta':
      return { type: 'agent:text_delta', agentId, content: event.content as string };
    case 'agent:tool_start':
      return {
        type: 'agent:tool_start',
        agentId,
        tool: event.tool as string,
        args: event.args as Record<string, unknown>,
        callId: event.callId as string,
      };
    case 'agent:tool_end':
      return {
        type: 'agent:tool_end',
        agentId,
        tool: event.tool as string,
        result: event.result,
        callId: event.callId as string,
        success: event.success as boolean,
      };
    case 'agent:error':
      return { type: 'agent:error', agentId, error: event.error as string };
    case 'agent:complete':
      return { type: 'agent:complete', agentId };
    case 'agent:heartbeat':
      return {
        type: 'agent:heartbeat',
        agentId,
        status: event.status as string,
        uptime: event.uptime as number,
      };
    case 'window:open':
      return {
        type: 'window:open',
        agentId,
        windowId: event.windowId as string,
        windowType: event.windowType as WindowType,
        title: event.title as string,
      };
    case 'window:close':
      return { type: 'window:close', agentId, windowId: event.windowId as string };
    case 'window:focus':
      return { type: 'window:focus', agentId, windowId: event.windowId as string };
    case 'window:update':
      return { type: 'window:update', agentId, windowId: event.windowId as string, data: event.data };
    case 'browser:navigating':
      return { type: 'browser:navigating', agentId, url: event.url as string };
    case 'browser:navigated':
      return { type: 'browser:navigated', agentId, url: event.url as string, title: event.title as string };
    case 'browser:screenshot':
      return { type: 'browser:screenshot', agentId, data: event.data as string };
    case 'browser:snapshot':
      return {
        type: 'browser:snapshot',
        agentId,
        snapshot: event.snapshot as string,
        refs: event.refs as Record<string, unknown>,
      };
    case 'browser:action':
      return { type: 'browser:action', agentId, action: event.action as string, target: event.target as string };
    case 'terminal:command':
      return { type: 'terminal:command', agentId, command: event.command as string, cwd: event.cwd as string };
    case 'terminal:output':
      return { type: 'terminal:output', agentId, data: event.data as string };
    case 'terminal:exit':
      return { type: 'terminal:exit', agentId, code: event.code as number };
    case 'fs:read':
      return { type: 'fs:read', agentId, path: event.path as string };
    case 'fs:write':
      return { type: 'fs:write', agentId, path: event.path as string };
    case 'fs:edit':
      return { type: 'fs:edit', agentId, path: event.path as string };
    default:
      return null;
  }
}
