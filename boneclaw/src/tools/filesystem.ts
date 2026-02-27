import type { Tool, ToolResult, ToolContext } from './types';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { emit, openWindow, updateWindow } from '../events/emitter';

// Track file editor windows
const editorWindows: Map<string, string> = new Map(); // path -> windowId

/**
 * Ensure a path is within the workspace (security)
 */
function ensureInWorkspace(path: string, workspace: string): string {
  const resolved = resolve(workspace, path);
  if (!resolved.startsWith(resolve(workspace))) {
    throw new Error(`Path ${path} is outside workspace`);
  }
  return resolved;
}

/**
 * Read file tool handler
 */
async function readHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const path = args.path as string;
  
  if (!path) {
    return { success: false, output: 'Path is required' };
  }

  try {
    const fullPath = ensureInWorkspace(path, context.workdir);
    
    if (!existsSync(fullPath)) {
      return { success: false, output: `File not found: ${path}` };
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return { success: false, output: `Path is a directory, use list tool instead: ${path}` };
    }

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    // Apply offset and limit
    const offset = (args.offset as number) || 0;
    const limit = (args.limit as number) || 2000;
    
    const selectedLines = lines.slice(offset, offset + limit);
    const numberedContent = selectedLines
      .map((line, i) => `${offset + i + 1}: ${line}`)
      .join('\n');

    emit({ type: 'fs:read', path: fullPath });

    return {
      success: true,
      output: numberedContent,
      data: {
        path: fullPath,
        totalLines: lines.length,
        offset,
        limit,
        truncated: lines.length > offset + limit,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Read error: ${errorMsg}` };
  }
}

/**
 * Write file tool handler
 */
async function writeHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const path = args.path as string;
  const content = args.content as string;
  
  if (!path) {
    return { success: false, output: 'Path is required' };
  }
  if (content === undefined) {
    return { success: false, output: 'Content is required' };
  }

  try {
    const fullPath = ensureInWorkspace(path, context.workdir);
    
    // Create directory if needed
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content, 'utf-8');
    
    emit({ type: 'fs:write', path: fullPath });

    // Open/update editor window
    let windowId = editorWindows.get(fullPath);
    if (!windowId) {
      windowId = openWindow('editor', path);
      editorWindows.set(fullPath, windowId);
    }
    updateWindow(windowId, { path: fullPath, content });

    return {
      success: true,
      output: `Successfully wrote ${content.length} bytes to ${path}`,
      data: { path: fullPath, bytes: content.length },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Write error: ${errorMsg}` };
  }
}

/**
 * Edit file tool handler (search/replace)
 */
async function editHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const path = args.path as string;
  const oldString = args.oldString as string;
  const newString = args.newString as string;
  const replaceAll = args.replaceAll as boolean;
  
  if (!path) {
    return { success: false, output: 'Path is required' };
  }
  if (oldString === undefined) {
    return { success: false, output: 'oldString is required' };
  }
  if (newString === undefined) {
    return { success: false, output: 'newString is required' };
  }

  try {
    const fullPath = ensureInWorkspace(path, context.workdir);
    
    if (!existsSync(fullPath)) {
      return { success: false, output: `File not found: ${path}` };
    }

    let content = readFileSync(fullPath, 'utf-8');
    
    // Check if oldString exists
    if (!content.includes(oldString)) {
      return { success: false, output: `oldString not found in file` };
    }

    // Count occurrences
    const occurrences = content.split(oldString).length - 1;
    if (occurrences > 1 && !replaceAll) {
      return { 
        success: false, 
        output: `Found ${occurrences} matches for oldString. Use replaceAll: true to replace all, or provide more context in oldString to make it unique.` 
      };
    }

    // Perform replacement
    if (replaceAll) {
      content = content.split(oldString).join(newString);
    } else {
      content = content.replace(oldString, newString);
    }

    writeFileSync(fullPath, content, 'utf-8');
    
    emit({ type: 'fs:edit', path: fullPath });

    // Update editor window
    let windowId = editorWindows.get(fullPath);
    if (!windowId) {
      windowId = openWindow('editor', path);
      editorWindows.set(fullPath, windowId);
    }
    updateWindow(windowId, { path: fullPath, content });

    return {
      success: true,
      output: `Successfully edited ${path}. Replaced ${replaceAll ? occurrences : 1} occurrence(s).`,
      data: { path: fullPath, replacements: replaceAll ? occurrences : 1 },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Edit error: ${errorMsg}` };
  }
}

/**
 * List directory tool handler
 */
async function listHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const path = (args.path as string) || '.';
  
  try {
    const fullPath = ensureInWorkspace(path, context.workdir);
    
    if (!existsSync(fullPath)) {
      return { success: false, output: `Path not found: ${path}` };
    }

    const stat = statSync(fullPath);
    if (!stat.isDirectory()) {
      return { success: false, output: `Path is not a directory: ${path}` };
    }

    const entries = readdirSync(fullPath);
    const detailed = entries.map((name) => {
      const entryPath = join(fullPath, name);
      const entryStat = statSync(entryPath);
      return {
        name,
        type: entryStat.isDirectory() ? 'dir' : 'file',
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
      };
    });

    // Format output
    const output = detailed
      .map((e) => `${e.type === 'dir' ? 'd' : '-'} ${e.name}${e.type === 'dir' ? '/' : ''}`)
      .join('\n');

    // Open files window
    openWindow('files', path);

    return {
      success: true,
      output: output || '(empty directory)',
      data: { path: fullPath, entries: detailed },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, output: `List error: ${errorMsg}` };
  }
}

export const readTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'read',
      description: `Read the contents of a file. Returns the file content with line numbers.

Use offset and limit for large files:
- offset: line number to start from (0-indexed)
- limit: maximum lines to return (default 2000)`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace)',
          },
          offset: {
            type: 'number',
            description: 'Line offset to start reading from (0-indexed)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default: 2000)',
          },
        },
        required: ['path'],
      },
    },
  },
  handler: readHandler,
};

export const writeTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'write',
      description: `Write content to a file. Creates the file if it doesn't exist, overwrites if it does.
Creates parent directories automatically.`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace)',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  handler: writeHandler,
};

export const editTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit',
      description: `Edit a file by replacing text. Searches for oldString and replaces with newString.

Important:
- If oldString appears multiple times, you must either use replaceAll: true or provide more context to make it unique
- The edit will fail if oldString is not found`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace)',
          },
          oldString: {
            type: 'string',
            description: 'Text to search for and replace',
          },
          newString: {
            type: 'string',
            description: 'Replacement text',
          },
          replaceAll: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false)',
          },
        },
        required: ['path', 'oldString', 'newString'],
      },
    },
  },
  handler: editHandler,
};

export const listTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'list',
      description: `List contents of a directory. Shows files and subdirectories with their types.`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the directory (relative to workspace, defaults to current directory)',
          },
        },
        required: [],
      },
    },
  },
  handler: listHandler,
};
