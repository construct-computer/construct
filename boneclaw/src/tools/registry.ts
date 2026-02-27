import type { Tool, ToolHandler, ToolContext, ToolResult } from './types';
import type { ToolDefinition, ParsedToolCall } from '../llm/types';
import { browserTool } from './browser';
import { execTool } from './exec';
import { readTool, writeTool, editTool, listTool } from './filesystem';
import { emitToolStart, emitToolEnd } from '../events/emitter';

/**
 * Tool registry - manages all available tools
 */
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.definition.function.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Global registry instance
export const registry = new ToolRegistry();

// Register all tools
registry.register(browserTool);
registry.register(execTool);
registry.register(readTool);
registry.register(writeTool);
registry.register(editTool);
registry.register(listTool);

/**
 * Execute a tool call
 */
export async function executeTool(
  call: ParsedToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const tool = registry.get(call.name);
  
  if (!tool) {
    return {
      success: false,
      output: `Unknown tool: ${call.name}. Available tools: ${registry.getToolNames().join(', ')}`,
    };
  }

  emitToolStart(call.name, call.arguments, call.id);

  try {
    const result = await tool.handler(call.arguments, context);
    emitToolEnd(call.name, result.output, call.id, result.success);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    emitToolEnd(call.name, errorMsg, call.id, false);
    return {
      success: false,
      output: `Tool error: ${errorMsg}`,
    };
  }
}

/**
 * Get all tool definitions for the LLM
 */
export function getToolDefinitions(): ToolDefinition[] {
  return registry.getDefinitions();
}
