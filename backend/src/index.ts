import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config, validateConfig, logConfig } from './config';
import { initDatabase, closeDatabase } from './db/client';
import { authRoutes } from './routes/auth';
import { instanceRoutes } from './routes/instances';
import { createDriveRoutes } from './routes/drive';
import { wsRoutes } from './ws/handler';
import { 
  initializeServices, shutdownServices, 
  containerManager, browserClient, agentClient, instances,
  driveService, driveSync,
  type Instance
} from './services';

// Validate configuration
validateConfig();

// Initialize database
console.log('Initializing database...');
initDatabase(config.dbPath);

// Log configuration
logConfig();

// Initialize services
console.log('Initializing services...');
initializeServices().then(() => {
  // Discover and adopt existing containers on startup
  const discovered = containerManager.discoverRunningContainers();
  console.log(`[Startup] Found ${discovered.size} running containers`);
  
  for (const [instanceId, info] of discovered) {
    containerManager.adoptContainer(instanceId, info.containerId, info.ports);
    
    // Create instance record
    const instance: Instance = {
      id: instanceId,
      userId: instanceId, // In our model, instanceId = userId
      status: 'running',
      createdAt: new Date(),
    };
    instances.set(instanceId, instance);
    
    // Create browser and agent sessions
    browserClient.createSession(instanceId).catch(err => {
      console.error(`[Startup] Failed to create browser session for ${instanceId}:`, err.message);
    });
    agentClient.createSession(instanceId, info.ports.agent);
    
    console.log(`[Startup] Adopted instance ${instanceId}`);
  }
}).catch(err => {
  console.error('Failed to initialize services:', err);
});

// Create app
const app = new Elysia()
  // CORS
  .use(cors({
    origin: config.corsOrigins,
    credentials: true,
  }))
  // Health check
  .get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      containers: containerManager.getStats().containers,
      browserSessions: browserClient.getStats().activeSessions,
      agentSessions: agentClient.sessionCount,
    };
  })
  // API routes
  .group('/api', (app) =>
    app
      .use(authRoutes)
      .use(instanceRoutes)
      .use(createDriveRoutes(driveService, driveSync))
  )
  // WebSocket routes
  .use(wsRoutes)
  // Error handling
  .onError(({ code, error, request, set }) => {
    if (code === 'NOT_FOUND') {
      // Silent 404 — don't log (favicon.ico, missing routes, etc.)
      set.status = 404;
      return { error: 'Not found' };
    }
    
    if (code === 'VALIDATION') {
      const path = new URL(request.url).pathname;
      console.warn(`[400] ${request.method} ${path}: ${error.message}`);
      set.status = 400;
      return { error: 'Validation error', details: error.message };
    }
    
    // Log actual server errors (one line, no stack trace)
    const path = new URL(request.url).pathname;
    console.error(`[${code}] ${request.method} ${path}: ${error.message}`);
    set.status = 500;
    return { error: 'Internal server error' };
  })
  // Start server
  .listen({
    port: config.port,
    hostname: config.host,
  });

console.log(`
  ██████╗ ██████╗ ███╗   ██╗███████╗████████╗██████╗ ██╗   ██╗ ██████╗████████╗
 ██╔════╝██╔═══██╗████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║   ██║██╔════╝╚══██╔══╝
 ██║     ██║   ██║██╔██╗ ██║███████╗   ██║   ██████╔╝██║   ██║██║        ██║   
 ██║     ██║   ██║██║╚██╗██║╚════██║   ██║   ██╔══██╗██║   ██║██║        ██║   
 ╚██████╗╚██████╔╝██║ ╚████║███████║   ██║   ██║  ██║╚██████╔╝╚██████╗   ██║   
  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝  ╚═════╝   ╚═╝   
                                                                               
  construct.computer backend running at http://${config.host}:${config.port}
  
  API Endpoints:
    POST /api/auth/register   - Register new user
    POST /api/auth/login      - Login
    GET  /api/auth/me         - Get current user
    
    GET  /api/instances/me    - Get/create user's instance
    GET  /api/instances/:id   - Get instance
    POST /api/instances/:id/reboot - Reboot instance
    
    GET  /api/instances/:id/agent/config - Get agent config
    PUT  /api/instances/:id/agent/config - Update agent config (BYOK)
    POST /api/instances/:id/agent/chat   - Chat with agent
    GET  /api/instances/:id/agent/status - Get agent status
    
  Google Drive:
    GET  /api/drive/configured       - Check if Drive is configured
    GET  /api/drive/callback         - OAuth callback (from Google)
    GET  /api/drive/auth-url         - Get OAuth URL
    GET  /api/drive/status           - Connection status
    DEL  /api/drive/disconnect       - Disconnect Drive
    GET  /api/drive/files            - List Drive files
    POST /api/drive/upload           - Upload to Drive
    POST /api/drive/copy-to-drive/:id   - Container -> Drive
    POST /api/drive/copy-to-local/:id   - Drive -> Container
    POST /api/drive/sync/:id            - Two-way sync
    
  WebSocket Endpoints:
    WS   /ws/browser/:instanceId - Browser screencast stream
    WS   /ws/terminal/:instanceId - Terminal I/O
    WS   /ws/agent/:instanceId   - Agent events + chat
    
  Health: GET /health
`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await shutdownServices();
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await shutdownServices();
  closeDatabase();
  process.exit(0);
});

export { app };
