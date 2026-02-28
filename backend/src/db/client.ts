import { Database } from 'bun:sqlite';
import { SQL_SCHEMA } from './schema';
import type { User, Agent, AgentConfig, ActivityLog, DriveToken } from './schema';
import { nanoid } from 'nanoid';

let db: Database | null = null;

/**
 * Initialize the database
 */
export function initDatabase(dbPath: string = './data/construct.db'): Database {
  // Ensure data directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  if (dir) {
    try {
      Bun.spawnSync(['mkdir', '-p', dir]);
    } catch {
      // Directory might already exist
    }
  }

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  
  // Run schema
  db.exec(SQL_SCHEMA);
  
  return db;
}

/**
 * Get database instance
 */
export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

// ============= User Operations =============

export function createUser(username: string, passwordHash: string): User {
  const id = nanoid();
  const now = Date.now();
  
  const stmt = getDb().prepare(`
    INSERT INTO users (id, username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, username, passwordHash, now, now);
  
  return { id, username, passwordHash, createdAt: now, updatedAt: now };
}

export function getUserByUsername(username: string): User | null {
  const stmt = getDb().prepare(`
    SELECT id, username, password_hash as passwordHash, created_at as createdAt, updated_at as updatedAt
    FROM users WHERE username = ?
  `);
  
  return stmt.get(username) as User | null;
}

export function getUserById(id: string): User | null {
  const stmt = getDb().prepare(`
    SELECT id, username, password_hash as passwordHash, created_at as createdAt, updated_at as updatedAt
    FROM users WHERE id = ?
  `);
  
  return stmt.get(id) as User | null;
}

// ============= Agent Operations =============

export function createAgent(
  userId: string,
  name: string,
  description: string = ''
): Agent {
  const id = nanoid();
  const now = Date.now();
  
  const stmt = getDb().prepare(`
    INSERT INTO agents (id, user_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'creating', ?, ?)
  `);
  
  stmt.run(id, userId, name, description, now, now);
  
  return {
    id,
    userId,
    name,
    description,
    containerId: null,
    status: 'creating',
    createdAt: now,
    updatedAt: now,
    lastHeartbeat: null,
  };
}

export function getAgentById(id: string): Agent | null {
  const stmt = getDb().prepare(`
    SELECT id, user_id as userId, name, description, container_id as containerId,
           status, created_at as createdAt, updated_at as updatedAt, last_heartbeat as lastHeartbeat
    FROM agents WHERE id = ?
  `);
  
  return stmt.get(id) as Agent | null;
}

export function getAgentsByUserId(userId: string): Agent[] {
  const stmt = getDb().prepare(`
    SELECT id, user_id as userId, name, description, container_id as containerId,
           status, created_at as createdAt, updated_at as updatedAt, last_heartbeat as lastHeartbeat
    FROM agents WHERE user_id = ? ORDER BY created_at DESC
  `);
  
  return stmt.all(userId) as Agent[];
}

export function updateAgent(id: string, updates: Partial<Agent>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.containerId !== undefined) {
    fields.push('container_id = ?');
    values.push(updates.containerId);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.lastHeartbeat !== undefined) {
    fields.push('last_heartbeat = ?');
    values.push(updates.lastHeartbeat);
  }
  
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  
  const stmt = getDb().prepare(`
    UPDATE agents SET ${fields.join(', ')} WHERE id = ?
  `);
  
  stmt.run(...values);
}

export function deleteAgent(id: string): void {
  const stmt = getDb().prepare('DELETE FROM agents WHERE id = ?');
  stmt.run(id);
}

// ============= Agent Config Operations =============

export function createAgentConfig(
  agentId: string,
  openrouterKeyEncrypted: string,
  model: string = 'nvidia/nemotron-3-nano-30b-a3b:free'
): AgentConfig {
  const stmt = getDb().prepare(`
    INSERT INTO agent_configs (agent_id, openrouter_key_encrypted, model)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(agentId, openrouterKeyEncrypted, model);
  
  return {
    agentId,
    openrouterKeyEncrypted,
    model,
    goals: '[]',
    schedules: '[]',
    identityName: 'BoneClaw Agent',
    identityDescription: 'An autonomous AI agent',
  };
}

export function getAgentConfig(agentId: string): AgentConfig | null {
  const stmt = getDb().prepare(`
    SELECT agent_id as agentId, openrouter_key_encrypted as openrouterKeyEncrypted,
           model, goals, schedules, identity_name as identityName, identity_description as identityDescription
    FROM agent_configs WHERE agent_id = ?
  `);
  
  return stmt.get(agentId) as AgentConfig | null;
}

export function updateAgentConfig(agentId: string, updates: Partial<AgentConfig>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.openrouterKeyEncrypted !== undefined) {
    fields.push('openrouter_key_encrypted = ?');
    values.push(updates.openrouterKeyEncrypted);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.goals !== undefined) {
    fields.push('goals = ?');
    values.push(updates.goals);
  }
  if (updates.schedules !== undefined) {
    fields.push('schedules = ?');
    values.push(updates.schedules);
  }
  if (updates.identityName !== undefined) {
    fields.push('identity_name = ?');
    values.push(updates.identityName);
  }
  if (updates.identityDescription !== undefined) {
    fields.push('identity_description = ?');
    values.push(updates.identityDescription);
  }
  
  if (fields.length === 0) return;
  
  values.push(agentId);
  
  const stmt = getDb().prepare(`
    UPDATE agent_configs SET ${fields.join(', ')} WHERE agent_id = ?
  `);
  
  stmt.run(...values);
}

// ============= Activity Log Operations =============

export function createActivityLog(
  agentId: string,
  eventType: string,
  eventData: Record<string, unknown> = {}
): ActivityLog {
  const id = nanoid();
  const timestamp = Date.now();
  
  const stmt = getDb().prepare(`
    INSERT INTO activity_logs (id, agent_id, timestamp, event_type, event_data)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, agentId, timestamp, eventType, JSON.stringify(eventData));
  
  return { id, agentId, timestamp, eventType, eventData: JSON.stringify(eventData) };
}

export function getActivityLogs(
  agentId: string,
  limit: number = 100,
  offset: number = 0
): ActivityLog[] {
  const stmt = getDb().prepare(`
    SELECT id, agent_id as agentId, timestamp, event_type as eventType, event_data as eventData
    FROM activity_logs WHERE agent_id = ?
    ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `);
  
  return stmt.all(agentId, limit, offset) as ActivityLog[];
}

// ============= Drive Token Operations =============

export function saveDriveTokens(userId: string, tokens: {
  accessToken: string;
  refreshToken: string;
  expiry: string;
  email?: string;
}): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO drive_tokens (user_id, access_token, refresh_token, expiry, email)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(userId, tokens.accessToken, tokens.refreshToken, tokens.expiry, tokens.email ?? null);
}

export function getDriveTokens(userId: string): DriveToken | null {
  const stmt = getDb().prepare(`
    SELECT user_id as userId, access_token as accessToken, refresh_token as refreshToken,
           expiry, email, folder_id as folderId, last_sync as lastSync
    FROM drive_tokens WHERE user_id = ?
  `);
  return stmt.get(userId) as DriveToken | null;
}

export function updateDriveAccessToken(userId: string, accessToken: string, expiry: string): void {
  getDb().prepare('UPDATE drive_tokens SET access_token = ?, expiry = ? WHERE user_id = ?')
    .run(accessToken, expiry, userId);
}

export function updateDriveFolderId(userId: string, folderId: string): void {
  getDb().prepare('UPDATE drive_tokens SET folder_id = ? WHERE user_id = ?')
    .run(folderId, userId);
}

export function updateDriveLastSync(userId: string, timestamp: string): void {
  getDb().prepare('UPDATE drive_tokens SET last_sync = ? WHERE user_id = ?')
    .run(timestamp, userId);
}

export function deleteDriveTokens(userId: string): void {
  getDb().prepare('DELETE FROM drive_tokens WHERE user_id = ?').run(userId);
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
