import type { Tool, ToolResult, ToolContext } from './types';
import { spawn } from 'child_process';
import { emit, openWindow, updateWindow, closeWindow } from '../events/emitter';

// Track terminal windows
const terminalWindows: Map<string, string> = new Map(); // pid -> windowId
let terminalCounter = 0;

/**
 * Execute a shell command
 */
async function execCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>,
  timeout?: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...env },
      timeout: timeout || 300000, // 5 min default timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      emit({ type: 'terminal:output', data: text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      emit({ type: 'terminal:output', data: text });
    });

    proc.on('close', (code) => {
      emit({ type: 'terminal:exit', code: code ?? 0 });
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });

    proc.on('error', (err) => {
      emit({ type: 'terminal:exit', code: 1 });
      resolve({ stdout: '', stderr: err.message, code: 1 });
    });
  });
}

/**
 * Exec tool handler
 */
async function execHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const command = args.command as string;
  
  if (!command) {
    return { success: false, output: 'Command is required' };
  }

  const workdir = (args.workdir as string) || context.workdir;
  const env = args.env as Record<string, string> | undefined;
  const timeout = args.timeout as number | undefined;

  // Open terminal window in UI
  const windowId = openWindow('terminal', `Terminal ${++terminalCounter}`);
  
  // Emit command being executed
  emit({ type: 'terminal:command', command, cwd: workdir });

  try {
    const result = await execCommand(command, workdir, env, timeout);

    // Close terminal window after completion (optional - could keep open)
    // For now, we'll update it with the final output
    updateWindow(windowId, { 
      command, 
      output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''),
      exitCode: result.code,
      completed: true,
    });

    if (result.code !== 0) {
      return {
        success: false,
        output: result.stderr || result.stdout || `Command failed with exit code ${result.code}`,
        data: { exitCode: result.code, stdout: result.stdout, stderr: result.stderr },
      };
    }

    return {
      success: true,
      output: result.stdout || 'Command completed successfully',
      data: { exitCode: result.code, stdout: result.stdout, stderr: result.stderr },
    };
  } catch (error) {
    closeWindow(windowId);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Execution error: ${errorMsg}`,
    };
  }
}

export const execTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'exec',
      description: `Execute shell commands in the terminal. Use this to run programs, scripts, manage files, install packages, etc.

Examples:
- List files: exec({ command: "ls -la" })
- Install package: exec({ command: "npm install express" })
- Run script: exec({ command: "python script.py" })
- Git operations: exec({ command: "git status" })

The command runs in a bash shell. Output is streamed in real-time.`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          workdir: {
            type: 'string',
            description: 'Working directory for the command (defaults to workspace)',
          },
          env: {
            type: 'object',
            description: 'Environment variables to set',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 300000 = 5 minutes)',
          },
        },
        required: ['command'],
      },
    },
  },
  handler: execHandler,
};
