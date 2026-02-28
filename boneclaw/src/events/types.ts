// Event types emitted by BoneClaw to stdout as JSON lines
// These are consumed by the backend and forwarded to the frontend

export type AgentEvent =
  | { type: 'agent:started'; timestamp: number; config: { name: string; model: string } }
  | { type: 'agent:thinking'; content: string; timestamp: number }
  | { type: 'agent:text'; content: string; timestamp: number }
  | { type: 'agent:text_delta'; content: string; timestamp: number }
  | { type: 'agent:tool_start'; tool: string; args: Record<string, unknown>; callId: string; timestamp: number }
  | { type: 'agent:tool_end'; tool: string; result: unknown; callId: string; success: boolean; timestamp: number }
  | { type: 'agent:error'; error: string; timestamp: number }
  | { type: 'agent:complete'; timestamp: number }
  | { type: 'agent:heartbeat'; status: AgentStatus; uptime: number; timestamp: number }
  | { type: 'agent:goal_started'; goalId: string; description: string; timestamp: number }
  | { type: 'agent:goal_completed'; goalId: string; timestamp: number }
  | { type: 'agent:scheduled_task'; taskId: string; action: string; timestamp: number }
  // Window/UI events for frontend rendering
  | { type: 'window:open'; windowId: string; windowType: WindowType; title: string; timestamp: number }
  | { type: 'window:close'; windowId: string; timestamp: number }
  | { type: 'window:focus'; windowId: string; timestamp: number }
  | { type: 'window:update'; windowId: string; data: unknown; timestamp: number }
  // Browser-specific events
  | { type: 'browser:navigating'; url: string; timestamp: number }
  | { type: 'browser:navigated'; url: string; title: string; timestamp: number }
  | { type: 'browser:screenshot'; data: string; timestamp: number }
  | { type: 'browser:snapshot'; snapshot: string; refs: Record<string, unknown>; timestamp: number }
  | { type: 'browser:action'; action: string; target?: string; timestamp: number }
  // Terminal events
  | { type: 'terminal:command'; command: string; cwd: string; timestamp: number }
  | { type: 'terminal:output'; data: string; timestamp: number }
  | { type: 'terminal:exit'; code: number; timestamp: number }
  // File system events
  | { type: 'fs:read'; path: string; timestamp: number }
  | { type: 'fs:write'; path: string; timestamp: number }
  | { type: 'fs:edit'; path: string; timestamp: number }
  // TinyFish web agent events
  | { type: 'tinyfish:start'; url: string; goal: string; timestamp: number }
  | { type: 'tinyfish:started'; runId: string; timestamp: number }
  | { type: 'tinyfish:streaming_url'; runId: string; streamingUrl: string; timestamp: number }
  | { type: 'tinyfish:progress'; runId: string; purpose: string; timestamp: number }
  | { type: 'tinyfish:complete'; runId: string; status: string; result: unknown; error: string | null; timestamp: number }
  | { type: 'tinyfish:error'; error: string; timestamp: number };

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

export type WindowType = 'browser' | 'terminal' | 'files' | 'editor' | 'chat';

export interface WindowState {
  id: string;
  type: WindowType;
  title: string;
  visible: boolean;
  focused: boolean;
  data?: unknown;
}
