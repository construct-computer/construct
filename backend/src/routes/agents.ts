import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { getUser } from '../services/auth.service';
import {
  getAgent,
  listAgents,
  updateAgentConfiguration,
  startAgent,
  stopAgent,
  sendMessage,
  getAgentLogs,
  getAgentContainerLogs,
  getUserComputer,
} from '../services/agent.service';

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production';

// Auth derive function
async function authDerive(headers: Record<string, string | undefined>, jwtVerify: (token: string) => Promise<unknown>) {
  const authorization = headers.authorization;
  
  if (!authorization?.startsWith('Bearer ')) {
    return { user: null };
  }
  
  const token = authorization.slice(7);
  const payload = await jwtVerify(token) as { userId: string } | null;
  
  if (!payload) {
    return { user: null };
  }
  
  const user = getUser(payload.userId);
  return { user };
}

export const agentRoutes = new Elysia({ prefix: '/agents' })
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET,
    })
  )
  // Derive user from JWT for all routes
  .derive(async ({ headers, jwt }) => {
    return authDerive(headers, jwt.verify);
  })
  // Guard - require authentication
  .onBeforeHandle(({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })
  // Get user's computer (single agent per user)
  .get('/computer', async ({ user }) => {
    const computer = await getUserComputer(user!.id, user!.username);
    return { computer };
  })
  // List agents (deprecated - kept for compatibility)
  .get('/', async ({ user }) => {
    const agents = await listAgents(user!.id);
    return { agents };
  })
  // Get agent by ID
  .get('/:id', async ({ params, user, set }) => {
    const agent = await getAgent(params.id, user!.id);
    
    if (!agent) {
      set.status = 404;
      return { error: 'Agent not found' };
    }
    
    return { agent };
  })
  // Update agent
  .patch(
    '/:id',
    async ({ params, body, user, set }) => {
      const agent = await updateAgentConfiguration(params.id, user!.id, body);
      
      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }
      
      return { agent };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        openrouterApiKey: t.Optional(t.String()),
        model: t.Optional(t.String()),
        identityName: t.Optional(t.String({ maxLength: 64 })),
        identityDescription: t.Optional(t.String({ maxLength: 500 })),
        goals: t.Optional(t.Array(t.Object({
          id: t.String(),
          description: t.String(),
          priority: t.String(),
          status: t.String(),
        }))),
        schedules: t.Optional(t.Array(t.Object({
          id: t.String(),
          cron: t.String(),
          action: t.String(),
          enabled: t.Boolean(),
        }))),
      }),
    }
  )
  // Start agent
  .post('/:id/start', async ({ params, user, set }) => {
    try {
      const agent = await startAgent(params.id, user!.id);
      
      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }
      
      return { agent };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Failed to start agent' };
    }
  })
  // Stop agent
  .post('/:id/stop', async ({ params, user, set }) => {
    try {
      const agent = await stopAgent(params.id, user!.id);
      
      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }
      
      return { agent };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Failed to stop agent' };
    }
  })
  // Send message to agent
  .post(
    '/:id/message',
    async ({ params, body, user, set }) => {
      try {
        const sent = await sendMessage(params.id, user!.id, body.message);
        
        if (!sent) {
          set.status = 404;
          return { error: 'Agent not found' };
        }
        
        return { success: true };
      } catch (error) {
        set.status = 500;
        return { error: error instanceof Error ? error.message : 'Failed to send message' };
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
      }),
    }
  )
  // Get agent activity logs
  .get('/:id/activity', async ({ params, query, user, set }) => {
    const limit = query.limit ? parseInt(query.limit) : 100;
    const logs = getAgentLogs(params.id, user!.id, limit);
    
    if (logs === null) {
      set.status = 404;
      return { error: 'Agent not found' };
    }
    
    return { logs };
  })
  // Get agent container logs
  .get('/:id/logs', async ({ params, query, user, set }) => {
    const tail = query.tail ? parseInt(query.tail) : 100;
    
    try {
      const logs = await getAgentContainerLogs(params.id, user!.id, tail);
      
      if (logs === null) {
        set.status = 404;
        return { error: 'Agent not found or no container' };
      }
      
      return { logs };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Failed to get logs' };
    }
  });
