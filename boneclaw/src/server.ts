/**
 * HTTP/WebSocket server for boneclaw agent
 * Exposes the agent's functionality to the backend via:
 * - GET /status - Agent status
 * - GET /history - Conversation history
 * - POST /chat - Send a message to the agent
 * - WS /events - Stream agent events in real-time
 */

import type { ServerWebSocket } from 'bun';
import type { AgentEvent } from './events/types';
import type { AgentLoop } from './agent/loop';
import type { Memory } from './memory';

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

interface ServerOptions {
  port: number;
  agentLoop: AgentLoop;
  memory: Memory;
  startTime: number;
  config: {
    model: string;
    provider: string;
  };
}

let serverInstance: ReturnType<typeof Bun.serve> | null = null;

export function startServer(options: ServerOptions): ReturnType<typeof Bun.serve> {
  const { port, agentLoop, memory, startTime, config } = options;

  serverInstance = Bun.serve({
    port,
    
    fetch(req, server) {
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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }
      
      // GET /status - Agent status
      if (url.pathname === '/status' && req.method === 'GET') {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        return Response.json({
          running: true,
          model: config.model,
          provider: config.provider,
          session_count: 1,
          uptime_seconds: uptimeSeconds,
        }, { headers: corsHeaders });
      }
      
      // GET /history - Conversation history
      if (url.pathname === '/history' && req.method === 'GET') {
        const sessionKey = url.searchParams.get('session_key') || 'default';
        const messages = memory.getRecentContext();
        return Response.json({
          session_key: sessionKey,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }, { headers: corsHeaders });
      }
      
      // POST /chat - Send message to agent
      if (url.pathname === '/chat' && req.method === 'POST') {
        return handleChat(req, agentLoop, corsHeaders);
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
    
    websocket: {
      open(ws) {
        console.error('[Server] WebSocket client connected');
        eventClients.add(ws);
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

async function handleChat(
  req: Request, 
  agentLoop: AgentLoop,
  corsHeaders: Record<string, string>
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
    
    // Run the agent loop with the message
    // The agent loop will emit events that get broadcast to WebSocket clients
    const response = await agentLoop.run(message);
    
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
