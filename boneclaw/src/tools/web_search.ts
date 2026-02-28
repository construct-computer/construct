import type { Tool, ToolResult, ToolContext } from './types';
import type { Config } from '../config';
import { emit, openWindow } from '../events/emitter';

/**
 * TinyFish web_search tool — delegates web scraping/research tasks
 * to TinyFish's AI-powered browser automation via SSE streaming.
 * 
 * The agent (master) sends a natural language goal to TinyFish (slave),
 * which executes it in a cloud browser. Progress events stream back
 * in real-time and are forwarded to the frontend so the user sees
 * what TinyFish is doing — seamlessly alongside the local browser.
 */

// Module-level config reference (set by setConfig)
let tinyfishConfig: Config['tinyfish'] | null = null;

/** Tracks the currently active TinyFish session so state can be restored on reconnect. */
interface ActiveTinyfishSession {
  active: boolean;
  runId: string | null;
  streamingUrl: string | null;
  url: string;
  goal: string;
  lastProgress: string | null;
}

let activeSession: ActiveTinyfishSession = {
  active: false,
  runId: null,
  streamingUrl: null,
  url: '',
  goal: '',
  lastProgress: null,
};

/**
 * Set the TinyFish config. Called once at startup from main.ts.
 */
export function setTinyfishConfig(config: Config['tinyfish']): void {
  tinyfishConfig = config;
}

/**
 * Get the current TinyFish session state.
 * Used by the server to re-emit state on WebSocket reconnect.
 */
export function getTinyfishState(): ActiveTinyfishSession {
  return { ...activeSession };
}

/**
 * Parse a single SSE event from a chunk of text.
 * Returns parsed events and any remaining incomplete data.
 */
function parseSSEEvents(buffer: string): { events: Array<Record<string, unknown>>; remaining: string } {
  const events: Array<Record<string, unknown>> = [];
  const lines = buffer.split('\n');
  let remaining = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If this is the last line and doesn't end with \n, it's incomplete
    if (i === lines.length - 1 && !buffer.endsWith('\n')) {
      remaining = line;
      break;
    }

    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr) {
        try {
          events.push(JSON.parse(jsonStr));
        } catch {
          // Malformed JSON, skip
        }
      }
    }
    // Skip empty lines, comments, other SSE fields
  }

  return { events, remaining };
}

/**
 * Execute a TinyFish automation via SSE streaming.
 * Streams progress events to the frontend in real-time.
 */
async function runTinyfishSSE(
  url: string,
  goal: string,
  options: {
    browserProfile?: 'lite' | 'stealth';
    proxyCountry?: string;
  },
  context: ToolContext
): Promise<ToolResult> {
  if (!tinyfishConfig || !tinyfishConfig.apiKey) {
    // Notify the user with a visible toast so they know to configure the key
    emit({
      type: 'notification',
      title: 'TinyFish API Key Required',
      body: 'Add your TinyFish API key in Settings to enable web scraping and research.',
      variant: 'error',
      source: 'TinyFish',
    });
    return {
      success: false,
      output: 'TinyFish API key not configured. The user has been notified to add their TinyFish API key in Settings. Fall back to using the browser tool instead.',
    };
  }

  const apiUrl = `${tinyfishConfig.baseUrl}/v1/automation/run-sse`;

  const body: Record<string, unknown> = {
    url,
    goal,
    browser_profile: options.browserProfile || tinyfishConfig.defaultProfile || 'lite',
    api_integration: 'construct-computer',
  };

  if (options.proxyCountry) {
    body.proxy_config = {
      enabled: true,
      country_code: options.proxyCountry,
    };
  }

  // Track active session
  activeSession = {
    active: true,
    runId: null,
    streamingUrl: null,
    url,
    goal,
    lastProgress: null,
  };

  // Emit start event
  emit({
    type: 'tinyfish:start',
    url,
    goal,
  });

  // Open browser window to show TinyFish activity
  openWindow('browser', 'TinyFish Web Agent');

  let runId: string | null = null;
  let streamingUrl: string | null = null;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': tinyfishConfig.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorMsg = `TinyFish API error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json() as Record<string, unknown>;
        const err = errorBody.error as Record<string, unknown> | undefined;
        if (err?.message) {
          errorMsg = `TinyFish error: ${err.message}`;
        }
      } catch { /* use default error */ }

      emit({ type: 'tinyfish:error', error: errorMsg });
      emit({ type: 'tinyfish:complete', runId: null, status: 'FAILED', result: null, error: errorMsg });
      return { success: false, output: errorMsg };
    }

    if (!response.body) {
      const msg = 'TinyFish returned no response body';
      emit({ type: 'tinyfish:complete', runId: null, status: 'FAILED', result: null, error: msg });
      return { success: false, output: msg };
    }

    // Read the SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let result: Record<string, unknown> | null = null;
    let error: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const { events, remaining } = parseSSEEvents(sseBuffer);
      sseBuffer = remaining;

      for (const event of events) {
        const eventType = event.type as string;

        switch (eventType) {
          case 'STARTED': {
            runId = event.runId as string;
            activeSession.runId = runId;
            emit({
              type: 'tinyfish:started',
              runId,
            });
            break;
          }

          case 'STREAMING_URL': {
            streamingUrl = event.streamingUrl as string;
            activeSession.streamingUrl = streamingUrl;
            emit({
              type: 'tinyfish:streaming_url',
              runId: event.runId as string,
              streamingUrl,
            });
            break;
          }

          case 'PROGRESS': {
            const purpose = event.purpose as string;
            activeSession.lastProgress = purpose;
            emit({
              type: 'tinyfish:progress',
              runId: event.runId as string,
              purpose,
            });
            break;
          }

          case 'COMPLETE': {
            const status = event.status as string;
            if (status === 'COMPLETED') {
              result = (event.resultJson as Record<string, unknown>) || null;
            } else {
              error = (event.error as string) || `TinyFish run ${status}`;
              const helpMsg = event.help_message as string | undefined;
              if (helpMsg) error += ` - ${helpMsg}`;
            }

            emit({
              type: 'tinyfish:complete',
              runId: event.runId as string,
              status,
              result,
              error,
            });
            break;
          }

          case 'HEARTBEAT':
            // Connection keepalive, ignore
            break;

          default:
            break;
        }
      }
    }

    // Mark session inactive on any exit
    activeSession.active = false;

    // Ensure complete is always emitted if the SSE stream ended
    // without sending a COMPLETE event (e.g. connection dropped)
    if (!result && !error) {
      emit({ type: 'tinyfish:complete', runId, status: 'FAILED', result: null, error: 'Stream ended without result' });
      return {
        success: false,
        output: 'TinyFish automation completed but returned no result',
      };
    }

    // Build the tool result
    if (error) {
      return {
        success: false,
        output: `TinyFish automation failed: ${error}`,
      };
    }

    // Format result for the LLM
    let output = '## TinyFish Result\n\n';
    output += JSON.stringify(result, null, 2);
    if (streamingUrl) {
      output += `\n\n[Live browser replay: ${streamingUrl}]`;
    }
    return {
      success: true,
      output,
      data: { result, runId, streamingUrl },
    };

  } catch (err) {
    activeSession.active = false;
    const errorMsg = err instanceof Error ? err.message : String(err);
    emit({ type: 'tinyfish:error', error: errorMsg });
    emit({ type: 'tinyfish:complete', runId: null, status: 'FAILED', result: null, error: errorMsg });
    return {
      success: false,
      output: `TinyFish request failed: ${errorMsg}`,
    };
  }
}

/**
 * web_search tool handler
 */
async function webSearchHandler(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const url = args.url as string;
  const goal = args.goal as string;

  if (!url) {
    return { success: false, output: 'URL is required' };
  }
  if (!goal) {
    return { success: false, output: 'Goal is required — describe what data to extract or action to perform' };
  }

  const browserProfile = args.browser_profile as 'lite' | 'stealth' | undefined;
  const proxyCountry = args.proxy_country as string | undefined;

  return runTinyfishSSE(url, goal, { browserProfile, proxyCountry }, context);
}

export const webSearchTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: `Use TinyFish AI web agent to scrape websites, extract data, or perform research tasks on the web. TinyFish runs a cloud browser that can bypass anti-bot protections and CAPTCHAs.

USE THIS TOOL WHEN:
- Scraping data from websites (prices, articles, product info, etc.)
- Extracting structured data from pages
- Researching topics across multiple pages
- Accessing sites that block headless browsers or require CAPTCHA solving
- Collecting large amounts of data from a website
- Reading content from pages without needing to interact further

DO NOT USE THIS TOOL WHEN:
- You need to log into a website (use the browser tool instead)
- You need to fill forms, submit data, or interact with a site the user is watching
- You need real-time visual feedback on the local browser
- The task requires multi-step interactive workflows on the local desktop

The goal should be a clear, specific instruction describing what data to extract or what to do on the page. Include the desired output format (e.g., JSON schema) for structured results.`,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Target website URL to scrape/research',
          },
          goal: {
            type: 'string',
            description: 'Natural language description of what to extract or do on the website. Be specific about the data format you want.',
          },
          browser_profile: {
            type: 'string',
            enum: ['lite', 'stealth'],
            description: 'Browser profile. Use "stealth" for sites with anti-bot protection (Cloudflare, DataDome). Default: "lite".',
          },
          proxy_country: {
            type: 'string',
            enum: ['US', 'GB', 'CA', 'DE', 'FR', 'JP', 'AU'],
            description: 'Route through a proxy in this country. Useful for geo-restricted content.',
          },
        },
        required: ['url', 'goal'],
      },
    },
  },
  handler: webSearchHandler,
};
