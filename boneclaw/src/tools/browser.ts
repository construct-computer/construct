import type { Tool, ToolResult, ToolContext } from './types';
import { emit, openWindow, updateWindow, closeWindow } from '../events/emitter';
import { sendCommand, isSuccess, responseToText } from './browser-ipc';

// Track browser window ID
let browserWindowId: string | null = null;

// Actions that change the visible page — auto-snapshot + screenshot after these
const PAGE_CHANGING_ACTIONS = new Set([
  'open', 'click', 'fill', 'type', 'press', 'scroll', 'hover',
  'tab_switch', 'tab_new', 'snapshot',
]);

/**
 * Send a command to the agent-browser daemon and return {stdout, code} style result.
 * Thin wrapper over sendCommand that normalizes the response for the handler.
 */
async function runCommand(cmd: Record<string, unknown>): Promise<{ stdout: string; code: number; data?: Record<string, unknown> }> {
  try {
    const resp = await sendCommand(cmd);
    if (isSuccess(resp)) {
      return { stdout: responseToText(resp), code: 0, data: resp.data as Record<string, unknown> | undefined };
    }
    return { stdout: (resp.error as string) || 'Command failed', code: 1 };
  } catch (err) {
    return { stdout: err instanceof Error ? err.message : String(err), code: 1 };
  }
}

/**
 * Take a screenshot via IPC and return base64, or undefined on failure.
 */
async function takeScreenshot(): Promise<string | undefined> {
  try {
    const ssPath = '/tmp/agent-context.png';
    const resp = await sendCommand({ action: 'screenshot', path: ssPath });
    if (isSuccess(resp)) {
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
): Promise<ToolResult> {
  if (!basicResult.success) return basicResult;
  if (!PAGE_CHANGING_ACTIONS.has(action)) return basicResult;

  // Wait for the page to settle after the action
  const waitMs = action === 'open' || action === 'tab_new' ? 800 : 400;
  await new Promise(r => setTimeout(r, waitMs));

  let output = basicResult.output;

  // For non-snapshot actions, auto-take a snapshot to provide element refs
  if (action !== 'snapshot') {
    try {
      const snap = await sendCommand({ action: 'snapshot', interactive: true, compact: true });
      if (isSuccess(snap)) {
        let snapText = responseToText(snap);
        if (snapText.length > MAX_SNAPSHOT_CHARS) {
          snapText = snapText.slice(0, MAX_SNAPSHOT_CHARS) + '\n...(truncated)';
        }
        output += '\n\n--- Page elements (use refs like @e1 to interact) ---\n' + snapText;
      }
    } catch { /* ignore snapshot errors */ }
  }

  // Take screenshot for visual context (sent to LLM as image)
  const screenshot = await takeScreenshot();
  if (screenshot) {
    emit({ type: 'browser:screenshot', data: screenshot });
  }

  return { ...basicResult, output, screenshot };
}

/**
 * Browser tool handler — sends commands directly to the agent-browser daemon
 * via Unix socket IPC (no CLI process spawning).
 */
async function browserHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const action = args.action as string;

  // Build the daemon protocol command based on the action
  let result: { stdout: string; code: number; data?: Record<string, unknown> };

  switch (action) {
    case 'status': {
      // Check if daemon is reachable by sending a simple command
      try {
        const resp = await sendCommand({ action: 'url' });
        if (isSuccess(resp)) {
          const url = (resp.data as Record<string, unknown>)?.url || 'unknown';
          result = { stdout: `Browser active. Current URL: ${url}`, code: 0 };
        } else {
          result = { stdout: 'Browser not launched', code: 0 };
        }
      } catch {
        result = { stdout: 'Daemon not running', code: 1 };
      }
      break;
    }

    case 'open': {
      const url = args.url as string;
      if (!url) {
        return { success: false, output: 'URL is required for open action' };
      }

      // Open browser window in UI
      if (!browserWindowId) {
        browserWindowId = openWindow('browser', 'Browser');
      }
      emit({ type: 'browser:navigating', url });

      result = await runCommand({
        action: 'navigate',
        url,
        waitUntil: 'domcontentloaded',
      });

      if (result.code === 0) {
        emit({ type: 'browser:navigated', url, title: url });
        if (browserWindowId) {
          updateWindow(browserWindowId, { url, title: url });
        }
      }
      break;
    }

    case 'snapshot': {
      const snapCmd: Record<string, unknown> = {
        action: 'snapshot',
        interactive: args.interactive !== false ? true : undefined,
        compact: args.compact !== false ? true : undefined,
      };
      if (args.depth) snapCmd.maxDepth = Number(args.depth);
      result = await runCommand(snapCmd);

      // Emit snapshot event for the frontend
      if (result.code === 0 && result.data) {
        emit({
          type: 'browser:snapshot',
          snapshot: result.data.snapshot || '',
          refs: result.data.refs || {},
        });
      }
      break;
    }

    case 'screenshot': {
      const path = args.path as string || '/tmp/screenshot.png';
      result = await runCommand({
        action: 'screenshot',
        path,
        fullPage: args.full ? true : undefined,
        annotate: args.annotate ? true : undefined,
      });

      // Read and emit the screenshot
      if (result.code === 0) {
        try {
          const file = Bun.file(path);
          if (await file.exists()) {
            const buffer = await file.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            emit({ type: 'browser:screenshot', data: base64 });
          }
        } catch { /* ignore */ }
      }
      break;
    }

    case 'click': {
      const ref = args.ref as string;
      if (!ref) {
        return { success: false, output: 'Ref is required for click action (e.g., @e1)' };
      }
      emit({ type: 'browser:action', action: 'click', target: ref });
      result = await runCommand({ action: 'click', selector: ref });
      break;
    }

    case 'fill': {
      const ref = args.ref as string;
      const text = args.text as string;
      if (!ref || text === undefined) {
        return { success: false, output: 'Ref and text are required for fill action' };
      }
      emit({ type: 'browser:action', action: 'fill', target: ref });
      result = await runCommand({ action: 'fill', selector: ref, value: text });
      break;
    }

    case 'type': {
      const ref = args.ref as string;
      const text = args.text as string;
      if (!ref || text === undefined) {
        return { success: false, output: 'Ref and text are required for type action' };
      }
      emit({ type: 'browser:action', action: 'type', target: ref });
      result = await runCommand({ action: 'type', selector: ref, text });
      break;
    }

    case 'press': {
      const key = args.key as string;
      if (!key) {
        return { success: false, output: 'Key is required for press action (e.g., Enter, Tab)' };
      }
      emit({ type: 'browser:action', action: 'press', target: key });
      result = await runCommand({ action: 'press', key });
      break;
    }

    case 'hover': {
      const ref = args.ref as string;
      if (!ref) {
        return { success: false, output: 'Ref is required for hover action' };
      }
      emit({ type: 'browser:action', action: 'hover', target: ref });
      result = await runCommand({ action: 'hover', selector: ref });
      break;
    }

    case 'scroll': {
      const direction = args.direction as string || 'down';
      const amount = args.amount as number || 500;
      emit({ type: 'browser:action', action: 'scroll', target: direction });
      result = await runCommand({ action: 'scroll', direction, amount });
      break;
    }

    case 'wait': {
      if (args.text) {
        // Wait for text to appear — use waitforfunction with a DOM text check
        result = await runCommand({
          action: 'waitforfunction',
          expression: `document.body?.innerText?.includes(${JSON.stringify(args.text)})`,
          timeout: 10000,
        });
      } else if (args.selector) {
        result = await runCommand({
          action: 'wait',
          selector: args.selector as string,
        });
      } else if (args.ms) {
        result = await runCommand({
          action: 'wait',
          timeout: Number(args.ms),
        });
      } else {
        result = await runCommand({
          action: 'waitforloadstate',
          state: 'networkidle',
        });
      }
      break;
    }

    case 'get': {
      const what = args.what as string;
      const ref = args.ref as string;

      switch (what) {
        case 'title':
          result = await runCommand({ action: 'title' });
          break;
        case 'url':
          result = await runCommand({ action: 'url' });
          break;
        case 'text':
          if (!ref) return { success: false, output: 'Ref required for get text' };
          result = await runCommand({ action: 'gettext', selector: ref });
          break;
        case 'html':
          if (!ref) return { success: false, output: 'Ref required for get html' };
          result = await runCommand({ action: 'innerhtml', selector: ref });
          break;
        case 'value':
          if (!ref) return { success: false, output: 'Ref required for get value' };
          result = await runCommand({ action: 'inputvalue', selector: ref });
          break;
        default:
          return { success: false, output: `Unknown get target: ${what}` };
      }
      break;
    }

    case 'close': {
      result = await runCommand({ action: 'close' });
      if (browserWindowId) {
        closeWindow(browserWindowId);
        browserWindowId = null;
      }
      break;
    }

    case 'tabs': {
      result = await runCommand({ action: 'tab_list' });
      break;
    }

    case 'tab_new': {
      const url = args.url as string | undefined;

      // Ensure browser window is open in UI
      if (!browserWindowId) {
        browserWindowId = openWindow('browser', 'Browser');
      }
      if (url) {
        emit({ type: 'browser:navigating', url });
      }

      result = await runCommand({
        action: 'tab_new',
        ...(url && { url }),
      });
      break;
    }

    case 'tab_close': {
      const index = args.index as number;
      result = await runCommand({
        action: 'tab_close',
        ...(index !== undefined && { index }),
      });
      break;
    }

    case 'tab_switch': {
      const index = args.index as number;
      if (index === undefined) {
        return { success: false, output: 'Index is required for tab_switch action' };
      }
      emit({ type: 'browser:action', action: 'tab_switch', target: String(index) });
      result = await runCommand({ action: 'tab_switch', index });
      break;
    }

    default:
      return { success: false, output: `Unknown browser action: ${action}` };
  }

  if (result.code !== 0) {
    return {
      success: false,
      output: result.stdout || 'Browser command failed',
    };
  }

  const basicResult: ToolResult = {
    success: true,
    output: result.stdout || 'OK',
    ...(result.data && { data: result.data }),
  };

  return enhanceWithVisualContext(basicResult, action);
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
          depth: {
            type: 'number',
            description: 'Limit snapshot tree depth',
          },
        },
        required: ['action'],
      },
    },
  },
  handler: browserHandler,
};
