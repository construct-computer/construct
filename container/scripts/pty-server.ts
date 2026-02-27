#!/usr/bin/env bun

/**
 * PTY Server - WebSocket server for terminal streaming
 * Allows the frontend to interact with a terminal in the container
 */

import { spawn } from 'node:child_process';
import * as pty from 'node-pty'; // We'll use node-pty if available, otherwise fallback

const PORT = parseInt(process.env.PTY_SERVER_PORT || '9224', 10);
const SHELL = process.env.SHELL || '/bin/bash';

interface Connection {
  ws: WebSocket;
  pty: ReturnType<typeof spawn> | null;
}

const connections = new Map<string, Connection>();

// Simple WebSocket server using Bun
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Upgrade to WebSocket
    const success = server.upgrade(req);
    if (success) return undefined;
    
    // Health check endpoint
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', connections: connections.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return new Response('PTY Server - Connect via WebSocket', { status: 200 });
  },
  websocket: {
    open(ws) {
      const id = Math.random().toString(36).substring(7);
      console.log(`PTY connection opened: ${id}`);
      
      // Spawn a new PTY
      const ptyProcess = spawn(SHELL, [], {
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
        cwd: process.env.HOME || '/home/agent',
      });
      
      // Forward PTY output to WebSocket
      ptyProcess.stdout?.on('data', (data) => {
        try {
          ws.send(JSON.stringify({
            type: 'output',
            data: data.toString(),
          }));
        } catch {
          // Connection might be closed
        }
      });
      
      ptyProcess.stderr?.on('data', (data) => {
        try {
          ws.send(JSON.stringify({
            type: 'output',
            data: data.toString(),
          }));
        } catch {
          // Connection might be closed
        }
      });
      
      ptyProcess.on('close', (code) => {
        try {
          ws.send(JSON.stringify({
            type: 'exit',
            code,
          }));
          ws.close();
        } catch {
          // Connection might already be closed
        }
      });
      
      connections.set(id, { ws, pty: ptyProcess });
      (ws as any).connectionId = id;
      
      // Send initial prompt info
      ws.send(JSON.stringify({
        type: 'connected',
        id,
        shell: SHELL,
        cwd: process.env.HOME || '/home/agent',
      }));
    },
    
    message(ws, message) {
      const id = (ws as any).connectionId;
      const connection = connections.get(id);
      
      if (!connection || !connection.pty) {
        return;
      }
      
      try {
        const event = typeof message === 'string' ? JSON.parse(message) : message;
        
        if (event.type === 'input') {
          // Write input to PTY
          connection.pty.stdin?.write(event.data);
        } else if (event.type === 'resize') {
          // Handle resize (not supported with basic spawn, need node-pty)
          console.log(`Resize requested: ${event.cols}x${event.rows}`);
        } else if (event.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    },
    
    close(ws) {
      const id = (ws as any).connectionId;
      const connection = connections.get(id);
      
      if (connection) {
        // Kill the PTY process
        connection.pty?.kill();
        connections.delete(id);
        console.log(`PTY connection closed: ${id}`);
      }
    },
  },
});

console.log(`PTY Server running on port ${PORT}`);
console.log(`Shell: ${SHELL}`);
console.log(`Home: ${process.env.HOME || '/home/agent'}`);

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down PTY server...');
  for (const [id, connection] of connections) {
    connection.pty?.kill();
    connection.ws.close();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down PTY server...');
  for (const [id, connection] of connections) {
    connection.pty?.kill();
    connection.ws.close();
  }
  process.exit(0);
});
