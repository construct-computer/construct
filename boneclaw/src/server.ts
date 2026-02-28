/**
 * HTTP/WebSocket server for boneclaw agent
 * Exposes the agent's functionality to the backend via:
 * - GET /status - Agent status
 * - GET /history - Conversation history
 * - POST /chat - Send a message to the agent
 * - POST /notify - Send a desktop notification (used by notify-send shim)
 * - WS /events - Stream agent events in real-time
 */

import type { ServerWebSocket } from 'bun';
import type { AgentEvent } from './events/types';
import type { AgentLoop } from './agent/loop';
import type { Memory } from './memory';
import type { SessionManager } from './memory/sessions';
import { getTinyfishState } from './tools/web_search';

// WebSocket clients subscribed to events
const eventClients = new Set<ServerWebSocket<unknown>>();

/**
 * Transform boneclaw events to the format the frontend expects.
 * Boneclaw uses: { type: 'agent:tool_start', tool: '...', ... }
 * Frontend expects: { type: 'tool_call', timestamp: ..., data: { tool: '...', ... } }
 */
function transformEvent(event: AgentEvent): Record<string, unknown> {
  const { type, timestamp, ...rest } = event as AgentEvent & { timestamp: number };
  
  // Map boneclaw event types to frontend-expected types
  const typeMap: Record<string, string> = {
    'agent:text_delta': 'text_delta',
    'agent:thinking': 'thinking',
    'agent:tool_start': 'tool_call',
    'agent:tool_end': 'tool_result',
    'agent:error': 'error',
    'agent:complete': 'status_change',
    'agent:started': 'agent:started',
    // Window events pass through
    'window:open': 'window:open',
    'window:close': 'window:close',
    'window:focus': 'window:focus',
    'window:update': 'window:update',
    // Browser events pass through
    'browser:navigating': 'browser:navigating',
    'browser:navigated': 'browser:navigated',
    'browser:screenshot': 'browser:screenshot',
    'browser:snapshot': 'browser:snapshot',
    'browser:action': 'browser:action',
    // Terminal events pass through
    'terminal:command': 'terminal:command',
    'terminal:output': 'terminal:output',
    'terminal:exit': 'terminal:exit',
    // TinyFish events pass through
    'tinyfish:start': 'tinyfish:start',
    'tinyfish:started': 'tinyfish:started',
    'tinyfish:streaming_url': 'tinyfish:streaming_url',
    'tinyfish:progress': 'tinyfish:progress',
    'tinyfish:complete': 'tinyfish:complete',
    'tinyfish:error': 'tinyfish:error',
    // Filesystem events pass through
    'fs:read': 'fs:read',
    'fs:write': 'fs:write',
    'fs:edit': 'fs:edit',
  };

  const mappedType = typeMap[type] || type;
  
  // Transform data structure based on event type
  let data: Record<string, unknown> = { ...rest };
  
  // Special handling for specific event types
  if (type === 'agent:text_delta') {
    // Frontend expects { data: { delta: '...' } }
    data = { delta: (event as any).content };
  } else if (type === 'agent:thinking') {
    // Frontend expects { data: { content: '...' } }
    data = { content: (event as any).content };
  } else if (type === 'agent:tool_start') {
    // Frontend expects { data: { tool: '...', args: {...}, name: '...' } }
    const e = event as any;
    data = { tool: e.tool, name: e.tool, args: e.args, params: e.args, callId: e.callId };
  } else if (type === 'agent:tool_end') {
    // Frontend expects { data: { tool: '...', result: {...}, name: '...' } }
    const e = event as any;
    data = { tool: e.tool, name: e.tool, result: e.result, callId: e.callId, success: e.success };
  } else if (type === 'agent:complete') {
    // Map to status_change with idle status
    data = { status: 'idle' };
  } else if (type === 'agent:error') {
    data = { message: (event as any).error };
  }
  
  return {
    type: mappedType,
    timestamp,
    data,
  };
}

// Broadcast an event to all connected WebSocket clients
export function broadcastEvent(event: AgentEvent): void {
  const transformed = transformEvent(event);
  const message = JSON.stringify(transformed);
  for (const client of eventClients) {
    try {
      client.send(message);
    } catch {
      // Client disconnected, will be cleaned up
    }
  }
}

/** Model used for cheap background tasks (title generation). Free tier. */
const TITLE_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';

interface ServerOptions {
  port: number;
  agentLoop: AgentLoop;
  memory: Memory;
  sessions: SessionManager;
  startTime: number;
  config: {
    model: string;
    provider: string;
  };
  /** Needed for background LLM calls (auto-title generation). */
  openrouter: {
    apiKey: string;
    baseUrl: string;
  };
}

let serverInstance: ReturnType<typeof Bun.serve> | null = null;

export function startServer(options: ServerOptions): ReturnType<typeof Bun.serve> {
  const { port, agentLoop, sessions, startTime, config, openrouter } = options;

  serverInstance = Bun.serve({
    port,
    
    async fetch(req, server) {
      const url = new URL(req.url);
      
      // Handle WebSocket upgrade for /events
      if (url.pathname === '/events') {
        const upgraded = server.upgrade(req, { data: {} });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }
      
      // CORS headers for all responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }
      
      // GET /status - Agent status
      if (url.pathname === '/status' && req.method === 'GET') {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const tf = getTinyfishState();
        return Response.json({
          running: true,
          model: config.model,
          provider: config.provider,
          session_count: 1,
          uptime_seconds: uptimeSeconds,
          tinyfish: tf.active ? {
            active: true,
            streamingUrl: tf.streamingUrl,
            url: tf.url,
            goal: tf.goal,
            lastProgress: tf.lastProgress,
          } : { active: false },
        }, { headers: corsHeaders });
      }
      
      // GET /history - Conversation history (session-aware)
      if (url.pathname === '/history' && req.method === 'GET') {
        const sessionKey = url.searchParams.get('session_key') || sessions.getActiveKey();
        const mem = agentLoop.getMemory(sessionKey);
        return Response.json({
          session_key: sessionKey,
          messages: mem.getRecentContext().map(m => ({
            role: m.role,
            content: m.content,
            // Include tool_calls so the frontend can reconstruct activity logs
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          })),
        }, { headers: corsHeaders });
      }
      
      // POST /chat - Send message to agent (session-aware)
      if (url.pathname === '/chat' && req.method === 'POST') {
        return handleChat(req, agentLoop, sessions, openrouter, corsHeaders);
      }
      
      // POST /abort - Stop the currently running agent loop
      if (url.pathname === '/abort' && req.method === 'POST') {
        const aborted = agentLoop.abort();
        return Response.json({ aborted }, { headers: corsHeaders });
      }
      
      // POST /notify - Send a desktop notification (used by notify-send shim)
      if (url.pathname === '/notify' && req.method === 'POST') {
        try {
          const body = await req.json() as { title?: string; body?: string; variant?: string };
          const title = body.title || 'Notification';
          const nBody = body.body || undefined;
          const variant = body.variant || 'info';
          
          broadcastEvent({
            type: 'notification',
            title,
            body: nBody,
            variant,
            source: 'Construct Agent',
            timestamp: Date.now(),
          } as unknown as AgentEvent);
          
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch {
          return Response.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
        }
      }
      
      // GET /sessions - List all chat sessions
      if (url.pathname === '/sessions' && req.method === 'GET') {
        return Response.json({
          sessions: sessions.listSessions(),
          active_key: sessions.getActiveKey(),
        }, { headers: corsHeaders });
      }
      
      // POST /sessions - Create a new session
      if (url.pathname === '/sessions' && req.method === 'POST') {
        try {
          const body = await req.json() as { title?: string };
          const info = sessions.createSession(body.title);
          return Response.json(info, { status: 201, headers: corsHeaders });
        } catch {
          return Response.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
        }
      }
      
      // DELETE /sessions/:key - Delete a session
      const deleteMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        const key = deleteMatch[1];
        const ok = sessions.deleteSession(key);
        if (!ok) {
          return Response.json(
            { error: 'Cannot delete session (not found or last remaining)' },
            { status: 400, headers: corsHeaders },
          );
        }
        return Response.json({ ok: true, active_key: sessions.getActiveKey() }, { headers: corsHeaders });
      }
      
      // PUT /sessions/:key - Rename a session
      const putMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (putMatch && req.method === 'PUT') {
        try {
          const body = await req.json() as { title?: string };
          const key = putMatch[1];
          if (!body.title) {
            return Response.json({ error: 'title is required' }, { status: 400, headers: corsHeaders });
          }
          const ok = sessions.renameSession(key, body.title);
          if (!ok) {
            return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders });
          }
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch {
          return Response.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
        }
      }
      
      // PUT /sessions/:key/activate - Switch active session
      const activateMatch = url.pathname.match(/^\/sessions\/([^/]+)\/activate$/);
      if (activateMatch && req.method === 'PUT') {
        const key = activateMatch[1];
        const ok = sessions.setActiveKey(key);
        if (!ok) {
          return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders });
        }
        return Response.json({ ok: true, active_key: key }, { headers: corsHeaders });
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
    
    websocket: {
      open(ws) {
        console.error('[Server] WebSocket client connected');
        eventClients.add(ws);
        
        // If TinyFish is currently active, re-emit its state so the
        // newly connected client (e.g. after page refresh) picks it up.
        const tf = getTinyfishState();
        if (tf.active) {
          if (tf.streamingUrl) {
            const urlEvent = transformEvent({
              type: 'tinyfish:streaming_url',
              runId: tf.runId || '',
              streamingUrl: tf.streamingUrl,
              timestamp: Date.now(),
            } as AgentEvent);
            try { ws.send(JSON.stringify(urlEvent)); } catch { /* */ }
          }
          if (tf.lastProgress) {
            const progressEvent = transformEvent({
              type: 'tinyfish:progress',
              runId: tf.runId || '',
              purpose: tf.lastProgress,
              timestamp: Date.now(),
            } as AgentEvent);
            try { ws.send(JSON.stringify(progressEvent)); } catch { /* */ }
          }
        }
      },
      
      message(_ws, _message) {
        // We don't expect messages from clients on the events endpoint
        // Chat is handled via HTTP POST
      },
      
      close(ws) {
        console.error('[Server] WebSocket client disconnected');
        eventClients.delete(ws);
      },
    },
  });

  console.error(`[Server] HTTP server started on port ${port}`);
  return serverInstance;
}

/**
 * Generate a short chat title from the user's first message.
 * Fire-and-forget — errors are silently ignored.
 */
async function generateSessionTitle(
  userMessage: string,
  openrouter: { apiKey: string; baseUrl: string },
  sessions: SessionManager,
  sessionKey: string,
): Promise<void> {
  if (!openrouter.apiKey) return;

  try {
    const res = await fetch(`${openrouter.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouter.apiKey}`,
        'HTTP-Referer': 'https://construct.computer',
        'X-Title': 'BoneClaw Agent',
      },
      body: JSON.stringify({
        model: TITLE_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Generate a very short chat title (max 64 characters) that summarises what the user wants to talk about. ' +
              'Reply with ONLY the title text, no quotes, no punctuation at the end, no extra explanation.',
          },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 32,
        temperature: 0.5,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let title = data.choices?.[0]?.message?.content?.trim();
    if (!title) return;

    // Enforce 64-char cap and strip surrounding quotes
    title = title.replace(/^["']|["']$/g, '').slice(0, 64);

    sessions.renameSession(sessionKey, title);

    // Broadcast so the frontend picks up the new name
    broadcastEvent({
      type: 'session:renamed',
      sessionKey,
      title,
      timestamp: Date.now(),
    } as unknown as AgentEvent);
  } catch {
    // Best-effort — don't break the chat flow
  }
}

async function handleChat(
  req: Request, 
  agentLoop: AgentLoop,
  sessions: SessionManager,
  openrouter: { apiKey: string; baseUrl: string },
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const body = await req.json() as { message?: string; session_key?: string };
    const message = body.message;
    const sessionKey = body.session_key || 'http_default';
    
    if (!message || typeof message !== 'string') {
      return Response.json(
        { error: 'Message is required' }, 
        { status: 400, headers: corsHeaders }
      );
    }

    // Check if this is the first message in the session (title is still "New Chat" / "New Chat N")
    const sessionInfo = sessions.getSession(sessionKey);
    const isFirstMessage = !!sessionInfo && /^New Chat( \d+)?$/.test(sessionInfo.title);
    
    // Run the agent loop with the message (session-aware)
    // The agent loop will emit events that get broadcast to WebSocket clients
    const response = await agentLoop.run(message, sessionKey);

    // Auto-generate a title after the first message (fire-and-forget)
    if (isFirstMessage) {
      generateSessionTitle(message, openrouter, sessions, sessionKey);
    }
    
    return Response.json({
      response: response || 'OK',
      session_key: sessionKey,
    }, { headers: corsHeaders });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: errorMsg }, 
      { status: 500, headers: corsHeaders }
    );
  }
}

export function stopServer(): void {
  if (serverInstance) {
    serverInstance.stop();
    serverInstance = null;
  }
  eventClients.clear();
}

export function getClientCount(): number {
  return eventClients.size;
}
