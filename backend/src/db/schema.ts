// Database schema types for construct.computer

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  description: string;
  containerId: string | null;
  status: 'creating' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';
  createdAt: number;
  updatedAt: number;
  lastHeartbeat: number | null;
}

export interface AgentConfig {
  agentId: string;
  openrouterKeyEncrypted: string;
  model: string;
  goals: string; // JSON array
  schedules: string; // JSON array
  identityName: string;
  identityDescription: string;
}

export interface ActivityLog {
  id: string;
  agentId: string;
  timestamp: number;
  eventType: string;
  eventData: string; // JSON
}

export interface Session {
  id: string;
  userId: string;
  agentId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface DriveToken {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiry: string;
  email: string | null;
  folderId: string | null;
  lastSync: string | null;
}

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  userId: string; // construct.computer user_id
  botToken: string; // encrypted xoxb-...
  botUserId: string; // Slack bot user ID (for stripping mentions)
  installedAt: number;
}

export interface SlackThreadSession {
  teamId: string;
  channelId: string;
  threadTs: string;
  sessionKey: string; // boneclaw session key
  createdAt: number;
}

// SQL schema for SQLite
export const SQL_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  container_id TEXT,
  status TEXT NOT NULL DEFAULT 'creating',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  last_heartbeat INTEGER
);

-- Agent configs table (separate for sensitive data)
CREATE TABLE IF NOT EXISTS agent_configs (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  openrouter_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'nvidia/nemotron-3-nano-30b-a3b:free',
  goals TEXT DEFAULT '[]',
  schedules TEXT DEFAULT '[]',
  identity_name TEXT DEFAULT 'BoneClaw Agent',
  identity_description TEXT DEFAULT 'An autonomous AI agent'
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  event_type TEXT NOT NULL,
  event_data TEXT DEFAULT '{}'
);

-- Google Drive tokens table
CREATE TABLE IF NOT EXISTS drive_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry TEXT NOT NULL,
  email TEXT,
  folder_id TEXT,
  last_sync TEXT
);

-- Slack installations (one per workspace, linked to a construct.computer user)
CREATE TABLE IF NOT EXISTS slack_installations (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  installed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Slack thread → boneclaw session mapping
CREATE TABLE IF NOT EXISTS slack_thread_sessions (
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  session_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (team_id, channel_id, thread_ts)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_agent_id ON activity_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_slack_installations_user_id ON slack_installations(user_id);
`;
