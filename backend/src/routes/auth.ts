import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { register, login, getUser } from '../services/auth.service';

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production';
const JWT_EXPIRY = '7d';

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET,
      exp: JWT_EXPIRY,
    })
  )
  // Register
  .post(
    '/register',
    async ({ body, jwt, set }) => {
      const result = await register(body.username, body.password);
      
      if (!result.success) {
        set.status = 400;
        return { error: result.error };
      }
      
      // Generate JWT token
      const token = await jwt.sign({
        userId: result.user!.id,
        username: result.user!.username,
      });
      
      return {
        user: result.user,
        token,
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 32 }),
        password: t.String({ minLength: 8 }),
      }),
    }
  )
  // Login
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      const result = await login(body.username, body.password);
      
      if (!result.success) {
        set.status = 401;
        return { error: result.error };
      }
      
      // Generate JWT token
      const token = await jwt.sign({
        userId: result.user!.id,
        username: result.user!.username,
      });
      
      return {
        user: result.user,
        token,
      };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
      }),
    }
  )
  // Get current user
  .get(
    '/me',
    async ({ headers, jwt, set }) => {
      const authorization = headers.authorization;
      
      if (!authorization?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      
      const token = authorization.slice(7);
      const payload = await jwt.verify(token);
      
      if (!payload) {
        set.status = 401;
        return { error: 'Invalid token' };
      }
      
      const user = getUser(payload.userId as string);
      
      if (!user) {
        set.status = 401;
        return { error: 'User not found' };
      }
      
      return { user };
    }
  )
  // Refresh token
  .post(
    '/refresh',
    async ({ headers, jwt, set }) => {
      const authorization = headers.authorization;
      
      if (!authorization?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      
      const token = authorization.slice(7);
      const payload = await jwt.verify(token);
      
      if (!payload) {
        set.status = 401;
        return { error: 'Invalid token' };
      }
      
      const user = getUser(payload.userId as string);
      
      if (!user) {
        set.status = 401;
        return { error: 'User not found' };
      }
      
      // Generate new token
      const newToken = await jwt.sign({
        userId: user.id,
        username: user.username,
      });
      
      return {
        user,
        token: newToken,
      };
    }
  );

/**
 * Auth middleware - verifies JWT and adds user to context
 */
export function createAuthMiddleware(jwtInstance: ReturnType<typeof jwt>) {
  return async ({ headers, set }: { headers: Record<string, string | undefined>; set: { status: number } }) => {
    const authorization = headers.authorization;
    
    if (!authorization?.startsWith('Bearer ')) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    
    const token = authorization.slice(7);
    const payload = await jwtInstance.verify(token);
    
    if (!payload) {
      set.status = 401;
      return { error: 'Invalid token' };
    }
    
    const user = getUser(payload.userId as string);
    
    if (!user) {
      set.status = 401;
      return { error: 'User not found' };
    }
    
    return { user };
  };
}
