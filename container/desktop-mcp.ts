/**
 * Desktop MCP Server — Exposes browser interaction capabilities as MCP tools
 * via the stdio (JSON-RPC 2.0 over stdin/stdout) transport.
 *
 * Uses agent-browser CLI for all browser interactions, providing:
 *   - Accessibility tree snapshots with refs (@e1, @e2) for deterministic targeting
 *   - Selector-based interaction (CSS, ARIA roles, text)
 *   - Proper wait primitives (waitForSelector, networkidle)
 *   - JavaScript evaluation
 *   - Screenshot with annotations
 *
 * Tools exposed:
 *   browser_snapshot    — Get accessibility tree with interactive refs
 *   browser_screenshot  — Capture a screenshot (optionally annotated)
 *   browser_click       — Click element by ref (@e1), selector, or coordinates
 *   browser_type        — Type text into the focused element
 *   browser_fill        — Clear and fill an input by ref/selector
 *   browser_press       — Press a keyboard key
 *   browser_scroll      — Scroll the page
 *   browser_navigate    — Navigate to a URL
 *   browser_back        — Go back in history
 *   browser_forward     — Go forward in history
 *   browser_wait        — Wait for element, text, or load state
 *   browser_eval        — Execute JavaScript in page context
 *   browser_get_tabs    — List all open browser tabs
 *   browser_new_tab     — Open a new tab
 *   browser_close_tab   — Close a tab
 *   browser_switch_tab  — Switch to a tab
 *   browser_hover       — Hover over an element
 *   browser_select      — Select dropdown option
 */

import { execSync, spawn } from 'child_process'
import * as readline from 'readline'

// ─── Constants ──────────────────────────────────────────────────────────────

const CMD_TIMEOUT = 30_000

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: any
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: any
  error?: { code: number; message: string }
}

// ─── agent-browser CLI helper ───────────────────────────────────────────────

function agentBrowser(args: string[], timeoutMs = CMD_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('agent-browser', args, {
      timeout: timeoutMs,
      env: { ...process.env, AGENT_BROWSER_SESSION: 'default' },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || stdout.trim() || `agent-browser exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

// ─── MCP Tool Definitions ───────────────────────────────────────────────────

interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

const tools: McpTool[] = [
  {
    name: 'browser_snapshot',
    description:
      'Get the accessibility tree of the current page with interactive element refs (@e1, @e2, etc). Use these refs with browser_click, browser_fill, browser_hover, etc. This is the primary way to understand what\'s on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        interactive_only: {
          type: 'boolean',
          description: 'Only show interactive elements (buttons, links, inputs). Default: true.',
        },
        compact: {
          type: 'boolean',
          description: 'Remove empty structural elements. Default: true.',
        },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current page. Optionally annotate with numbered labels on interactive elements.',
    inputSchema: {
      type: 'object',
      properties: {
        annotate: {
          type: 'boolean',
          description: 'Add numbered labels on interactive elements. Default: false.',
        },
        full: {
          type: 'boolean',
          description: 'Capture full page (not just viewport). Default: false.',
        },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element. Use a ref from browser_snapshot (e.g. "@e3"), a CSS selector (e.g. "#submit"), or coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Element ref (e.g. "@e3"), CSS selector (e.g. "#submit"), or text selector (e.g. "text=Login").',
        },
        x: { type: 'integer', description: 'X coordinate (alternative to target).' },
        y: { type: 'integer', description: 'Y coordinate (alternative to target).' },
      },
    },
  },
  {
    name: 'browser_type',
    description: 'Type text using keyboard (into the currently focused element). Use browser_click first to focus an input.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Clear and fill an input field by ref or selector. This clears existing content first, unlike browser_type.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (e.g. "@e3") or CSS selector.' },
        text: { type: 'string', description: 'Text to fill.' },
      },
      required: ['target', 'text'],
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key. Common keys: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Control+a, Control+c, Control+v.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g. "Enter", "Tab", "Control+a").' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page. Directions: up, down, left, right. Default amount is ~500px.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction.',
        },
        amount: { type: 'integer', description: 'Scroll amount in pixels. Default: 500.' },
        selector: { type: 'string', description: 'Optional: scroll within a specific element.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_forward',
    description: 'Go forward in browser history.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a condition: element visibility, text appearance, URL pattern, or load state (load, domcontentloaded, networkidle).',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for.' },
        text: { type: 'string', description: 'Text to wait for on the page.' },
        url: { type: 'string', description: 'URL pattern to wait for (supports **).' },
        load: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Wait for a load state.',
        },
        timeout: { type: 'integer', description: 'Timeout in milliseconds. Default: 10000.' },
      },
    },
  },
  {
    name: 'browser_eval',
    description: 'Execute JavaScript in the page context and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate.' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element by ref or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (e.g. "@e3") or CSS selector.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select a dropdown option by ref or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (e.g. "@e3") or CSS selector.' },
        value: { type: 'string', description: 'Option value to select.' },
      },
      required: ['target', 'value'],
    },
  },
  {
    name: 'browser_get_tabs',
    description: 'List all open browser tabs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_new_tab',
    description: 'Open a new browser tab, optionally navigating to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional URL to navigate to.' },
      },
    },
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab. Closes the current tab if no index specified.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Tab index to close (0-based).' },
      },
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a browser tab by index (0-based).',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Tab index to switch to (0-based).' },
      },
      required: ['index'],
    },
  },
]

// ─── Tool Execution ─────────────────────────────────────────────────────────

interface McpContent {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

async function executeTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
  try {
    switch (name) {
      case 'browser_snapshot': {
        const cmdArgs = ['snapshot']
        if (args.interactive_only !== false) cmdArgs.push('-i')
        if (args.compact !== false) cmdArgs.push('-c')
        const result = await agentBrowser(cmdArgs)
        const url = await agentBrowser(['get', 'url']).catch(() => '')
        const title = await agentBrowser(['get', 'title']).catch(() => '')
        return textResult(`=== Browser Page ===\nURL: ${url}\nTitle: ${title}\n\n${result}`)
      }

      case 'browser_screenshot': {
        const path = `/tmp/construct-screenshot-${Date.now()}.png`
        const cmdArgs = ['screenshot', path]
        if (args.full) cmdArgs.push('--full')
        if (args.annotate) cmdArgs.push('--annotate')
        const output = await agentBrowser(cmdArgs)
        try {
          const fs = await import('fs')
          const buffer = fs.readFileSync(path)
          const result: McpContent[] = [
            { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' },
          ]
          if (output) result.push({ type: 'text', text: output })
          // Clean up
          try { fs.unlinkSync(path) } catch {}
          return { content: result }
        } catch {
          return textResult(output || 'Screenshot captured.')
        }
      }

      case 'browser_click': {
        if (args.target) {
          await agentBrowser(['click', args.target])
        } else if (args.x !== undefined && args.y !== undefined) {
          // Use eval for coordinate-based clicking as a fallback
          await agentBrowser(['eval', `document.elementFromPoint(${args.x}, ${args.y})?.click()`])
        } else {
          return errorResult('Provide a target ref/selector (e.g. "@e3", "#submit") or x,y coordinates.')
        }
        // Get updated snapshot after clicking
        await sleep(300)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Clicked ${args.target || `(${args.x}, ${args.y})`}.\n\n${snapshot}`)
      }

      case 'browser_type': {
        if (!args.text) return errorResult('text is required.')
        await agentBrowser(['keyboard', 'type', args.text])
        return textResult(`Typed: "${args.text}"`)
      }

      case 'browser_fill': {
        if (!args.target || args.text === undefined) return errorResult('target and text are required.')
        await agentBrowser(['fill', args.target, args.text])
        return textResult(`Filled ${args.target} with "${args.text}".`)
      }

      case 'browser_press': {
        if (!args.key) return errorResult('key is required.')
        await agentBrowser(['press', args.key])
        return textResult(`Pressed: ${args.key}`)
      }

      case 'browser_scroll': {
        const dir = args.direction || 'down'
        const amount = args.amount || 500
        const cmdArgs = ['scroll', dir, String(amount)]
        if (args.selector) cmdArgs.push('--selector', args.selector)
        await agentBrowser(cmdArgs)
        await sleep(300)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Scrolled ${dir} ${amount}px.\n\n${snapshot}`)
      }

      case 'browser_navigate': {
        if (!args.url) return errorResult('url is required.')
        await agentBrowser(['open', args.url])
        await sleep(500)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        const url = await agentBrowser(['get', 'url']).catch(() => args.url)
        const title = await agentBrowser(['get', 'title']).catch(() => '')
        return textResult(`Navigated to: ${url}\nTitle: ${title}\n\n${snapshot}`)
      }

      case 'browser_back': {
        await agentBrowser(['back'])
        await sleep(500)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Went back.\n\n${snapshot}`)
      }

      case 'browser_forward': {
        await agentBrowser(['forward'])
        await sleep(500)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Went forward.\n\n${snapshot}`)
      }

      case 'browser_wait': {
        const cmdArgs = ['wait']
        if (args.selector) cmdArgs.push(args.selector)
        else if (args.text) cmdArgs.push('--text', args.text)
        else if (args.url) cmdArgs.push('--url', args.url)
        else if (args.load) cmdArgs.push('--load', args.load)
        else if (args.timeout) cmdArgs.push(String(args.timeout))
        else return errorResult('Specify selector, text, url, load, or timeout.')
        const output = await agentBrowser(cmdArgs, args.timeout || 15000)
        return textResult(output || 'Wait completed.')
      }

      case 'browser_eval': {
        if (!args.expression) return errorResult('expression is required.')
        const result = await agentBrowser(['eval', args.expression])
        return textResult(result || '(no output)')
      }

      case 'browser_hover': {
        if (!args.target) return errorResult('target is required.')
        await agentBrowser(['hover', args.target])
        return textResult(`Hovered over ${args.target}.`)
      }

      case 'browser_select': {
        if (!args.target || !args.value) return errorResult('target and value are required.')
        await agentBrowser(['select', args.target, args.value])
        return textResult(`Selected "${args.value}" in ${args.target}.`)
      }

      case 'browser_get_tabs': {
        const result = await agentBrowser(['tab'])
        return textResult(result || 'No tabs.')
      }

      case 'browser_new_tab': {
        if (args.url) {
          await agentBrowser(['tab', 'new', args.url])
        } else {
          await agentBrowser(['tab', 'new'])
        }
        await sleep(500)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Opened new tab${args.url ? ` at ${args.url}` : ''}.\n\n${snapshot}`)
      }

      case 'browser_close_tab': {
        if (args.index !== undefined) {
          await agentBrowser(['tab', 'close', String(args.index)])
        } else {
          await agentBrowser(['tab', 'close'])
        }
        return textResult('Tab closed.')
      }

      case 'browser_switch_tab': {
        if (args.index === undefined) return errorResult('index is required.')
        await agentBrowser(['tab', String(args.index)])
        await sleep(300)
        const snapshot = await agentBrowser(['snapshot', '-i', '-c']).catch(() => '')
        return textResult(`Switched to tab ${args.index}.\n\n${snapshot}`)
      }

      default:
        return errorResult(`Unknown tool: ${name}`)
    }
  } catch (err: any) {
    return errorResult(err.message || String(err))
  }
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── MCP Stdio Server ───────────────────────────────────────────────────────

class McpStdioServer {
  private rl: readline.Interface

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: undefined,
      terminal: false,
    })
  }

  start() {
    this.rl.on('line', async (line) => {
      let request: JsonRpcRequest
      try {
        request = JSON.parse(line)
      } catch {
        this.send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        return
      }

      const response = await this.handleRequest(request)
      if (response) {
        this.send(response)
      }
    })

    this.rl.on('close', () => {
      process.exit(0)
    })

    console.error('[desktop-mcp] Server started on stdio (agent-browser backend)')
  }

  private send(response: JsonRpcResponse) {
    process.stdout.write(JSON.stringify(response) + '\n')
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'desktop-mcp', version: '2.0.0' },
          },
        }

      case 'notifications/initialized':
        if (req.id) return { jsonrpc: '2.0', id: req.id, result: {} }
        return null

      case 'tools/list':
        return { jsonrpc: '2.0', id: req.id, result: { tools } }

      case 'tools/call': {
        const { name, arguments: toolArgs } = req.params || {}
        if (!name) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32602, message: 'Missing tool name' },
          }
        }
        const result = await executeTool(name, toolArgs || {})
        return { jsonrpc: '2.0', id: req.id, result }
      }

      default:
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        }
    }
  }
}

// Start the server.
const server = new McpStdioServer()
server.start()
