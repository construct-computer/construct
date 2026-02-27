import type { Tool, ToolResult, ToolContext } from './types';
import { spawn } from 'child_process';
import { emit, openWindow, updateWindow, closeWindow } from '../events/emitter';

// Track browser window ID
let browserWindowId: string | null = null;

// Actions that change the visible page — auto-snapshot + screenshot after these
const PAGE_CHANGING_ACTIONS = new Set([
  'open', 'click', 'fill', 'type', 'press', 'scroll', 'hover',
  'tab_switch', 'tab_new', 'snapshot',
]);

/**
 * Execute agent-browser CLI command
 */
async function runAgentBrowser(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('agent-browser', args, {
      cwd,
      timeout: 60_000,
      env: { ...process.env, AGENT_BROWSER_SESSION: 'default', PLAYWRIGHT_TIMEOUT: '45000' },
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
 * Take a screenshot and return it as base64, or undefined on failure
 */
async function takeScreenshot(cwd: string): Promise<string | undefined> {
  try {
    const ssPath = '/tmp/agent-context.png';
    const ss = await runAgentBrowser(['screenshot', ssPath], cwd);
    if (ss.code === 0) {
      const file = Bun.file(ssPath);
      if (await file.exists()) {
        const buf = await file.arrayBuffer();
        return Buffer.from(buf).toString('base64');
      }
    }
  } catch { /* ignore screenshot errors */ }
  return undefined;
}

const MAX_SNAPSHOT_CHARS = 8000;

/**
 * Enhance a browser tool result with auto-snapshot and screenshot for visual context.
 * Called after page-changing actions so the LLM can "see" the page and has refs ready.
 */
async function enhanceWithVisualContext(
  basicResult: ToolResult,
  action: string,
  cwd: string
): Promise<ToolResult> {
  if (!basicResult.success) return basicResult;
  if (!PAGE_CHANGING_ACTIONS.has(action)) return basicResult;

  // Wait for the page to settle after the action
  const waitMs = action === 'open' || action === 'tab_new' ? 800 : 400;
  await new Promise(r => setTimeout(r, waitMs));

  let output = basicResult.output;

  // For non-snapshot actions, auto-take a snapshot to provide element refs
  // (snapshot action already has its own output with refs)
  if (action !== 'snapshot') {
    try {
      const snap = await runAgentBrowser(['snapshot', '-i', '-c'], cwd);
      if (snap.code === 0 && snap.stdout) {
        let snapText = snap.stdout;
        if (snapText.length > MAX_SNAPSHOT_CHARS) {
          snapText = snapText.slice(0, MAX_SNAPSHOT_CHARS) + '\n...(truncated)';
        }
        output += '\n\n--- Page elements (use refs like @e1 to interact) ---\n' + snapText;
      }
    } catch { /* ignore snapshot errors */ }
  }

  // Take screenshot for visual context (sent to LLM as image)
  const screenshot = await takeScreenshot(cwd);
  if (screenshot) {
    emit({ type: 'browser:screenshot', data: screenshot });
  }

  return { ...basicResult, output, screenshot };
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
      // Use domcontentloaded instead of load for faster navigation
      cliArgs.push('open', url, '--wait', 'domcontentloaded');
      
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

    case 'tabs': {
      // List all open tabs
      cliArgs.push('tab');
      break;
    }

    case 'tab_new': {
      // Open a new tab, optionally with a URL
      const url = args.url as string;
      if (url) {
        cliArgs.push('tab', 'new', url);
      } else {
        cliArgs.push('tab', 'new');
      }
      
      // Ensure browser window is open in UI
      if (!browserWindowId) {
        browserWindowId = openWindow('browser', 'Browser');
      }
      
      if (url) {
        emit({ type: 'browser:navigating', url });
      }
      break;
    }

    case 'tab_close': {
      // Close a tab by index (0-based), or current tab if no index
      const index = args.index as number;
      if (index !== undefined) {
        cliArgs.push('tab', 'close', String(index));
      } else {
        cliArgs.push('tab', 'close');
      }
      break;
    }

    case 'tab_switch': {
      // Switch to a tab by index (0-based)
      const index = args.index as number;
      if (index === undefined) {
        return { success: false, output: 'Index is required for tab_switch action' };
      }
      cliArgs.push('tab', String(index));
      emit({ type: 'browser:action', action: 'tab_switch', target: String(index) });
      break;
    }

    default:
      return { success: false, output: `Unknown browser action: ${action}` };
  }

  // Add JSON output flag for parsing
  if (['snapshot', 'get', 'screenshot', 'status', 'tabs'].includes(action)) {
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
      const basicResult: ToolResult = {
        success: true,
        output: data.data?.snapshot || result.stdout,
        data,
      };
      // Enhance snapshot with a screenshot for visual context
      return enhanceWithVisualContext(basicResult, action, context.workdir);
    } catch {
      return enhanceWithVisualContext({ success: true, output: result.stdout }, action, context.workdir);
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

  // Handle explicit screenshot action
  if (action === 'screenshot' && result.stdout) {
    try {
      const data = JSON.parse(result.stdout);
      if (data.data?.path) {
        const file = Bun.file(data.data.path);
        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        emit({ type: 'browser:screenshot', data: base64 });
      }
    } catch {
      // Not JSON, just return stdout
    }
  }

  // Enhance page-changing actions with auto-snapshot + screenshot
  const basicResult: ToolResult = {
    success: true,
    output: result.stdout || 'OK',
  };
  return enhanceWithVisualContext(basicResult, action, context.workdir);
}

export const browserTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'browser',
      description: `Control the web browser. Use this to navigate websites, interact with elements, and extract information.

IMPORTANT: There is only ONE browser instance. To visit multiple websites, use tabs:
- 'open' navigates the current tab to a new URL
- 'tab_new' opens a new tab (optionally with a URL)
- 'tab_switch' switches between tabs
- 'tabs' lists all open tabs

VISUAL CONTEXT: After page-changing actions (open, click, fill, type, press, scroll, tab_switch, tab_new), you automatically receive:
1. A page snapshot with element refs (@e1, @e2, etc.) — use these to interact with elements
2. A screenshot of the page — you can SEE the current state

This means you do NOT need to call 'snapshot' separately after navigation or clicks — refs are already provided.

Workflow:
1. Use 'open' to navigate to a URL — you'll immediately get the page elements and a screenshot
2. Use refs (@e1, @e2) from the auto-snapshot to click, fill, type
3. After each interaction, you get updated refs and a new screenshot
4. Use 'snapshot' only if you need a fresh snapshot without performing an action

For multiple sites: use 'tab_new' with url, then 'tab_switch' to navigate between them.`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'open', 'snapshot', 'screenshot', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'wait', 'get', 'close', 'tabs', 'tab_new', 'tab_close', 'tab_switch'],
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
          index: {
            type: 'number',
            description: 'Tab index (0-based) for tab_switch or tab_close actions',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: browserHandler,
};
