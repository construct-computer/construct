import type { AgentEvent, WindowState, WindowType } from './types';

// Global window state tracking
const windows: Map<string, WindowState> = new Map();
let windowIdCounter = 0;

/**
 * Emit an event as a JSON line to stdout
 * The backend captures these and forwards to the frontend via WebSocket
 */
export function emit(event: Omit<AgentEvent, 'timestamp'>): void {
  const fullEvent = {
    ...event,
    timestamp: Date.now(),
  };
  
  // Write as JSON line to stdout
  console.log(JSON.stringify(fullEvent));
}

/**
 * Window management functions
 */
export function openWindow(type: WindowType, title: string, data?: unknown): string {
  const windowId = `window-${++windowIdCounter}`;
  
  const windowState: WindowState = {
    id: windowId,
    type,
    title,
    visible: true,
    focused: true,
    data,
  };
  
  // Unfocus other windows
  for (const [, win] of windows) {
    win.focused = false;
  }
  
  windows.set(windowId, windowState);
  
  emit({
    type: 'window:open',
    windowId,
    windowType: type,
    title,
  });
  
  return windowId;
}

export function closeWindow(windowId: string): void {
  if (windows.has(windowId)) {
    windows.delete(windowId);
    emit({ type: 'window:close', windowId });
  }
}

export function focusWindow(windowId: string): void {
  if (windows.has(windowId)) {
    for (const [, win] of windows) {
      win.focused = win.id === windowId;
    }
    emit({ type: 'window:focus', windowId });
  }
}

export function updateWindow(windowId: string, data: unknown): void {
  const win = windows.get(windowId);
  if (win) {
    win.data = data;
    emit({ type: 'window:update', windowId, data });
  }
}

export function getWindows(): WindowState[] {
  return Array.from(windows.values());
}

/**
 * Convenience functions for common events
 */
export function emitThinking(content: string): void {
  emit({ type: 'agent:thinking', content });
}

export function emitText(content: string): void {
  emit({ type: 'agent:text', content });
}

export function emitTextDelta(content: string): void {
  emit({ type: 'agent:text_delta', content });
}

export function emitToolStart(tool: string, args: Record<string, unknown>, callId: string): void {
  emit({ type: 'agent:tool_start', tool, args, callId });
}

export function emitToolEnd(tool: string, result: unknown, callId: string, success: boolean): void {
  emit({ type: 'agent:tool_end', tool, result, callId, success });
}

export function emitError(error: string): void {
  emit({ type: 'agent:error', error });
}

export function emitComplete(): void {
  emit({ type: 'agent:complete' });
}
