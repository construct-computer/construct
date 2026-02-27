import type { Tool, ToolResult, ToolContext } from './types';
import { spawn } from 'child_process';
import { emit, openWindow, updateWindow, closeWindow } from '../events/emitter';

// Track browser window ID
let browserWindowId: string | null = null;

/**
 * Execute agent-browser CLI command
 */
async function runAgentBrowser(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('agent-browser', args, {
      cwd,
      env: { ...process.env },
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
 * Browser tool handler
 */
async function browserHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const action = args.action as string;
  const cliArgs: string[] = [];

  switch (action) {
    case 'status': {
      cliArgs.push('session');
      break;
    }

    case 'open': {
      const url = args.url as string;
      if (!url) {
        return { success: false, output: 'URL is required for open action' };
      }
      cliArgs.push('open', url);
      
      // Open browser window in UI
      if (!browserWindowId) {
        browserWindowId = openWindow('browser', 'Browser');
      }
      
      emit({ type: 'browser:navigating', url });
      break;
    }

    case 'snapshot': {
      cliArgs.push('snapshot');
      if (args.interactive) cliArgs.push('-i');
      if (args.compact) cliArgs.push('-c');
      if (args.depth) cliArgs.push('-d', String(args.depth));
      break;
    }

    case 'screenshot': {
      const path = args.path as string || '/tmp/screenshot.png';
      cliArgs.push('screenshot', path);
      if (args.full) cliArgs.push('--full');
      if (args.annotate) cliArgs.push('--annotate');
      break;
    }

    case 'click': {
      const ref = args.ref as string;
      if (!ref) {
        return { success: false, output: 'Ref is required for click action (e.g., @e1)' };
      }
      cliArgs.push('click', ref);
      emit({ type: 'browser:action', action: 'click', target: ref });
      break;
    }

    case 'fill': {
      const ref = args.ref as string;
      const text = args.text as string;
      if (!ref || text === undefined) {
        return { success: false, output: 'Ref and text are required for fill action' };
      }
      cliArgs.push('fill', ref, text);
      emit({ type: 'browser:action', action: 'fill', target: ref });
      break;
    }

    case 'type': {
      const ref = args.ref as string;
      const text = args.text as string;
      if (!ref || text === undefined) {
        return { success: false, output: 'Ref and text are required for type action' };
      }
      cliArgs.push('type', ref, text);
      emit({ type: 'browser:action', action: 'type', target: ref });
      break;
    }

    case 'press': {
      const key = args.key as string;
      if (!key) {
        return { success: false, output: 'Key is required for press action (e.g., Enter, Tab)' };
      }
      cliArgs.push('press', key);
      emit({ type: 'browser:action', action: 'press', target: key });
      break;
    }

    case 'hover': {
      const ref = args.ref as string;
      if (!ref) {
        return { success: false, output: 'Ref is required for hover action' };
      }
      cliArgs.push('hover', ref);
      emit({ type: 'browser:action', action: 'hover', target: ref });
      break;
    }

    case 'scroll': {
      const direction = args.direction as string || 'down';
      const amount = args.amount as number || 500;
      cliArgs.push('scroll', direction, String(amount));
      emit({ type: 'browser:action', action: 'scroll', target: direction });
      break;
    }

    case 'wait': {
      if (args.text) {
        cliArgs.push('wait', '--text', args.text as string);
      } else if (args.selector) {
        cliArgs.push('wait', args.selector as string);
      } else if (args.ms) {
        cliArgs.push('wait', String(args.ms));
      } else {
        cliArgs.push('wait', '--load', 'networkidle');
      }
      break;
    }

    case 'get': {
      const what = args.what as string;
      const ref = args.ref as string;
      if (what === 'title') {
        cliArgs.push('get', 'title');
      } else if (what === 'url') {
        cliArgs.push('get', 'url');
      } else if (ref) {
        cliArgs.push('get', what, ref);
      } else {
        return { success: false, output: 'Invalid get action' };
      }
      break;
    }

    case 'close': {
      cliArgs.push('close');
      if (browserWindowId) {
        closeWindow(browserWindowId);
        browserWindowId = null;
      }
      break;
    }

    default:
      return { success: false, output: `Unknown browser action: ${action}` };
  }

  // Add JSON output flag for parsing
  if (['snapshot', 'get', 'screenshot', 'status'].includes(action)) {
    cliArgs.push('--json');
  }

  const result = await runAgentBrowser(cliArgs, context.workdir);

  if (result.code !== 0) {
    return {
      success: false,
      output: result.stderr || result.stdout || 'Browser command failed',
    };
  }

  // Parse JSON output for snapshot
  if (action === 'snapshot' && result.stdout) {
    try {
      const data = JSON.parse(result.stdout);
      emit({ type: 'browser:snapshot', snapshot: data.data?.snapshot || '', refs: data.data?.refs || {} });
      return {
        success: true,
        output: data.data?.snapshot || result.stdout,
        data,
      };
    } catch {
      return { success: true, output: result.stdout };
    }
  }

  // Parse navigated URL
  if (action === 'open') {
    const url = args.url as string;
    emit({ type: 'browser:navigated', url, title: url });
    if (browserWindowId) {
      updateWindow(browserWindowId, { url, title: url });
    }
  }

  // Handle screenshot
  if (action === 'screenshot' && result.stdout) {
    try {
      const data = JSON.parse(result.stdout);
      if (data.data?.path) {
        // Read screenshot and emit as base64
        const file = Bun.file(data.data.path);
        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        emit({ type: 'browser:screenshot', data: base64 });
      }
    } catch {
      // Not JSON, just return stdout
    }
  }

  return {
    success: true,
    output: result.stdout || 'OK',
  };
}

export const browserTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'browser',
      description: `Control the web browser. Use this to navigate websites, interact with elements, and extract information.

Workflow:
1. Use 'open' to navigate to a URL
2. Use 'snapshot' to get the page structure with element refs (e.g., @e1, @e2)
3. Use 'click', 'fill', 'type' with refs to interact
4. Use 'screenshot' for visual confirmation

Refs: After snapshot, elements have refs like @e1, @e2. Use these for interactions.`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'open', 'snapshot', 'screenshot', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'wait', 'get', 'close'],
            description: 'The browser action to perform',
          },
          url: {
            type: 'string',
            description: 'URL to navigate to (for open action)',
          },
          ref: {
            type: 'string',
            description: 'Element ref from snapshot (e.g., @e1, @e2)',
          },
          text: {
            type: 'string',
            description: 'Text to type or fill',
          },
          key: {
            type: 'string',
            description: 'Key to press (e.g., Enter, Tab, Escape)',
          },
          path: {
            type: 'string',
            description: 'File path for screenshot',
          },
          interactive: {
            type: 'boolean',
            description: 'Get only interactive elements in snapshot',
          },
          compact: {
            type: 'boolean',
            description: 'Compact snapshot output',
          },
          full: {
            type: 'boolean',
            description: 'Full page screenshot',
          },
          annotate: {
            type: 'boolean',
            description: 'Add numbered labels to screenshot',
          },
          what: {
            type: 'string',
            enum: ['text', 'html', 'value', 'title', 'url'],
            description: 'What to get from element or page',
          },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction',
          },
          amount: {
            type: 'number',
            description: 'Scroll amount in pixels',
          },
          selector: {
            type: 'string',
            description: 'CSS selector for wait',
          },
          ms: {
            type: 'number',
            description: 'Milliseconds to wait',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: browserHandler,
};
