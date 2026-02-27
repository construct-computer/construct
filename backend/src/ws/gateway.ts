import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { getUser } from '../services/auth.service';
import { getAgent, updateHeartbeat } from '../services/agent.service';
import { sendMessage } from '../services/agent.service';
import type { ServerEvent, ClientEvent } from './events';
import { convertAgentEvent } from './events';
import { nanoid } from 'nanoid';

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production';

// Connection registry
interface Connection {
  id: string;
  userId: string;
  ws: unknown; // WebSocket
  subscribedAgents: Set<string>;
}

const connections = new Map<string, Connection>();
const agentSubscribers = new Map<string, Set<string>>(); // agentId -> Set<connectionId>

/**
 * Broadcast event to all subscribers of an agent
 */
export function broadcastToAgent(agentId: string, event: ServerEvent): void {
  const subscribers = agentSubscribers.get(agentId);
  if (!subscribers) return;
  
  const message = JSON.stringify(event);
  
  for (const connectionId of subscribers) {
    const connection = connections.get(connectionId);
    if (connection && connection.ws) {
      try {
        (connection.ws as WebSocket).send(message);
      } catch {
        // Connection might be closed
      }
    }
  }
}

/**
 * Handle incoming agent events (from container logs)
 */
export function handleAgentEvent(agentId: string, event: Record<string, unknown>): void {
  // Convert to server event
  const serverEvent = convertAgentEvent(agentId, event);
  if (!serverEvent) return;
  
  // Update heartbeat if it's a heartbeat event
  if (event.type === 'agent:heartbeat') {
    updateHeartbeat(agentId);
  }
  
  // Broadcast to subscribers
  broadcastToAgent(agentId, serverEvent);
}

/**
 * WebSocket gateway for real-time events
 */
export const wsGateway = new Elysia()
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET,
    })
  )
  .ws('/ws', {
    async open(ws) {
      // Connection starts unauthenticated
      // Client must send auth token in first message
      const connectionId = nanoid();
      (ws.data as Record<string, unknown>).connectionId = connectionId;
      
      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        message: 'Send {"type":"auth","token":"..."} to authenticate',
      }));
    },
    
    async message(ws, message) {
      const connectionId = (ws.data as Record<string, unknown>).connectionId as string;
      let event: ClientEvent;
      
      try {
        event = typeof message === 'string' ? JSON.parse(message) : message as ClientEvent;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }
      
      // Handle ping
      if (event.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      
      // Handle authentication
      if ((event as { type: string; token?: string }).type === 'auth') {
        const token = (event as { token: string }).token;
        
        try {
          const payload = await ws.data.jwt.verify(token) as { userId: string } | null;
          
          if (!payload) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
            return;
          }
          
          const user = getUser(payload.userId);
          
          if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
            return;
          }
          
          // Register connection
          const connection: Connection = {
            id: connectionId,
            userId: user.id,
            ws,
            subscribedAgents: new Set(),
          };
          
          connections.set(connectionId, connection);
          
          ws.send(JSON.stringify({
            type: 'authenticated',
            userId: user.id,
            username: user.username,
          }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
        }
        return;
      }
      
      // All other events require authentication
      const connection = connections.get(connectionId);
      
      if (!connection) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }
      
      // Handle subscribe
      if (event.type === 'subscribe') {
        const agent = await getAgent(event.agentId, connection.userId);
        
        if (!agent) {
          ws.send(JSON.stringify({ type: 'error', message: 'Agent not found or access denied' }));
          return;
        }
        
        // Add to subscribers
        connection.subscribedAgents.add(event.agentId);
        
        let subscribers = agentSubscribers.get(event.agentId);
        if (!subscribers) {
          subscribers = new Set();
          agentSubscribers.set(event.agentId, subscribers);
        }
        subscribers.add(connectionId);
        
        ws.send(JSON.stringify({
          type: 'subscribed',
          agentId: event.agentId,
        }));
        
        // Send current agent status
        ws.send(JSON.stringify({
          type: 'agent:status',
          agentId: event.agentId,
          status: agent.status,
        }));
        
        return;
      }
      
      // Handle unsubscribe
      if (event.type === 'unsubscribe') {
        connection.subscribedAgents.delete(event.agentId);
        
        const subscribers = agentSubscribers.get(event.agentId);
        if (subscribers) {
          subscribers.delete(connectionId);
          if (subscribers.size === 0) {
            agentSubscribers.delete(event.agentId);
          }
        }
        
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          agentId: event.agentId,
        }));
        
        return;
      }
      
      // Handle agent message
      if (event.type === 'agent:message') {
        if (!connection.subscribedAgents.has(event.agentId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed to this agent' }));
          return;
        }
        
        try {
          await sendMessage(event.agentId, connection.userId, event.content);
          ws.send(JSON.stringify({
            type: 'message:sent',
            agentId: event.agentId,
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to send message',
          }));
        }
        
        return;
      }
      
      // Handle terminal input (forward to container)
      if (event.type === 'terminal:input') {
        if (!connection.subscribedAgents.has(event.agentId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed to this agent' }));
          return;
        }
        
        // TODO: Forward to container's PTY
        // This will be implemented when we set up the container communication
        
        return;
      }
      
      // Handle browser input (forward to container)
      if (event.type === 'browser:input') {
        if (!connection.subscribedAgents.has(event.agentId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed to this agent' }));
          return;
        }
        
        // TODO: Forward to container's browser stream
        // This will be implemented when we set up the container communication
        
        return;
      }
      
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown event type' }));
    },
    
    close(ws) {
      const connectionId = (ws.data as Record<string, unknown>).connectionId as string;
      const connection = connections.get(connectionId);
      
      if (connection) {
        // Remove from all agent subscriptions
        for (const agentId of connection.subscribedAgents) {
          const subscribers = agentSubscribers.get(agentId);
          if (subscribers) {
            subscribers.delete(connectionId);
            if (subscribers.size === 0) {
              agentSubscribers.delete(agentId);
            }
          }
        }
        
        // Remove connection
        connections.delete(connectionId);
      }
    },
  });

/**
 * Get number of active connections
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * Get number of subscribers for an agent
 */
export function getAgentSubscriberCount(agentId: string): number {
  return agentSubscribers.get(agentId)?.size ?? 0;
}
