import { createUser, getUserByUsername, getUserById } from '../db/client';
import { hashPassword, verifyPassword } from './crypto.service';
import { getUserComputer } from './agent.service';
import type { User } from '../db/schema';

export interface AuthResult {
  success: boolean;
  user?: Omit<User, 'passwordHash'>;
  error?: string;
}

/**
 * Register a new user
 */
export async function register(username: string, password: string): Promise<AuthResult> {
  // Validate username
  if (!username || username.length < 3 || username.length > 32) {
    return { success: false, error: 'Username must be 3-32 characters' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { success: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  // Validate password
  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }
  
  // Check if username exists
  const existing = getUserByUsername(username);
  if (existing) {
    return { success: false, error: 'Username already taken' };
  }
  
  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const user = createUser(username, passwordHash);
  
  // Create the user's computer (single agent/container)
  await getUserComputer(user.id, user.username);
  
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

/**
 * Login a user
 */
export async function login(username: string, password: string): Promise<AuthResult> {
  // Get user
  const user = getUserByUsername(username);
  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }
  
  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: 'Invalid username or password' };
  }
  
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

/**
 * Get user by ID (for JWT verification)
 */
export function getUser(userId: string): Omit<User, 'passwordHash'> | null {
  const user = getUserById(userId);
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
