import type { Tool, ToolResult, ToolContext } from './types';
import { spawn } from 'child_process';
import { emit } from '../events/emitter';

/**
 * Execute a shell command via child_process and capture output.
 * The frontend shows agent commands via activity log messages in the chat,
 * so we don't need to duplicate execution in tmux.
 */
async function execCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>,
  timeout?: number
): Promise<{ stdout: string; stderr: string; code: number }> {

  // Run via child_process to capture output for the agent
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...env },
      timeout: timeout || 300000, // 5 min default timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 });
    });
  });
}

/**
 * Exec tool handler.
 *
 * The frontend automatically opens/focuses the Terminal window when it
 * receives a tool_call event for 'exec' (via toolToWindowType mapping
 * in agentStore). We don't need to emit window:open events here.
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

  try {
    const result = await execCommand(command, workdir, env, timeout);

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
