import type { Tool, ToolResult, ToolContext } from './types';
import { spawn, execSync } from 'child_process';
import { emit } from '../events/emitter';

/**
 * Send a command to the shared tmux session so it executes visibly in the
 * frontend terminal. The user sees the command prompt, output, and exit —
 * exactly as if they typed it themselves.
 *
 * The actual output is captured separately via child_process (below) so we
 * can return structured results to the agent. This means the command runs
 * twice, but that's an acceptable tradeoff for real-time visibility.
 */
function runInTmux(command: string): void {
  try {
    const escaped = command.replace(/'/g, "'\\''");
    execSync(
      `tmux send-keys -t main '${escaped}' Enter`,
      { stdio: 'ignore', timeout: 2000 }
    );
  } catch {
    // tmux may not be available — ignore
  }
}

/**
 * Execute a shell command via child_process and capture output.
 * Also runs the command in tmux for frontend visibility.
 */
async function execCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>,
  timeout?: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  // Run in tmux so the user sees it in the frontend terminal
  runInTmux(command);

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
