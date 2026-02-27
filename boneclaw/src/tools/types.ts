import type { ToolDefinition } from '../llm/types';

/**
 * Tool execution context
 */
export interface ToolContext {
  workdir: string;
  emit: (event: unknown) => void;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}

/**
 * Tool handler function
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

/**
 * Complete tool definition including handler
 */
export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Browser tool actions
 */
export type BrowserAction =
  | 'status'
  | 'open'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'get'
  | 'close';

/**
 * File system operations
 */
export type FsOperation = 
  | 'read'
  | 'write'
  | 'edit'
  | 'list'
  | 'mkdir'
  | 'rm'
  | 'exists';
