import {
  createAgent as dbCreateAgent,
  getAgentById,
  getAgentsByUserId,
  updateAgent,
  deleteAgent as dbDeleteAgent,
  createAgentConfig,
  getAgentConfig,
  updateAgentConfig,
  getActivityLogs,
  createActivityLog,
} from '../db/client';
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  reconfigureContainer,
  getContainerInfo,
  sendMessageToAgent,
  getContainerLogs,
} from './container.service';
import { encrypt } from './crypto.service';
import type { Agent, AgentConfig } from '../db/schema';

export interface CreateAgentInput {
  userId: string;
  name: string;
  description?: string;
  openrouterApiKey: string;
  model?: string;
  identityName?: string;
  identityDescription?: string;
  goals?: Array<{ id: string; description: string; priority: string; status: string }>;
  schedules?: Array<{ id: string; cron: string; action: string; enabled: boolean }>;
}

export interface AgentWithConfig extends Agent {
  config?: Omit<AgentConfig, 'openrouterKeyEncrypted'>;
  containerInfo?: {
    status: string;
    ports: {
      browserStream?: number;
      ptyServer?: number;
    };
  };
}

/**
 * Create a new agent
 */
export async function createNewAgent(input: CreateAgentInput): Promise<AgentWithConfig> {
  // Create agent record
  const agent = dbCreateAgent(input.userId, input.name, input.description || '');
  
  // Encrypt API key
  const encryptedKey = await encrypt(input.openrouterApiKey);
  
  // Create agent config
  const config = createAgentConfig(
    agent.id,
    encryptedKey,
    input.model || 'nvidia/nemotron-nano-9b-v2:free'
  );
  
  // Update config with additional fields if provided
  if (input.identityName || input.identityDescription || input.goals || input.schedules) {
    updateAgentConfig(agent.id, {
      identityName: input.identityName,
      identityDescription: input.identityDescription,
      goals: input.goals ? JSON.stringify(input.goals) : undefined,
      schedules: input.schedules ? JSON.stringify(input.schedules) : undefined,
    });
  }
  
  createActivityLog(agent.id, 'agent:created', {
    name: agent.name,
    model: config.model,
  });
  
  return {
    ...agent,
    config: {
      agentId: config.agentId,
      model: config.model,
      goals: config.goals,
      schedules: config.schedules,
      identityName: config.identityName,
      identityDescription: config.identityDescription,
    },
  };
}

/**
 * Get an agent by ID with config and container info
 */
export async function getAgent(agentId: string, userId: string): Promise<AgentWithConfig | null> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  const config = getAgentConfig(agentId);
  const containerInfo = await getContainerInfo(agent);
  
  return {
    ...agent,
    config: config ? {
      agentId: config.agentId,
      model: config.model,
      goals: config.goals,
      schedules: config.schedules,
      identityName: config.identityName,
      identityDescription: config.identityDescription,
    } : undefined,
    containerInfo: containerInfo ? {
      status: containerInfo.status,
      ports: containerInfo.ports,
    } : undefined,
  };
}

/**
 * List all agents for a user
 */
export async function listAgents(userId: string): Promise<AgentWithConfig[]> {
  const agents = getAgentsByUserId(userId);
  
  return Promise.all(agents.map(async (agent) => {
    const config = getAgentConfig(agent.id);
    const containerInfo = await getContainerInfo(agent);
    
    return {
      ...agent,
      config: config ? {
        agentId: config.agentId,
        model: config.model,
        goals: config.goals,
        schedules: config.schedules,
        identityName: config.identityName,
        identityDescription: config.identityDescription,
      } : undefined,
      containerInfo: containerInfo ? {
        status: containerInfo.status,
        ports: containerInfo.ports,
      } : undefined,
    };
  }));
}

/**
 * Update an agent's configuration
 */
export async function updateAgentConfiguration(
  agentId: string,
  userId: string,
  updates: {
    name?: string;
    description?: string;
    openrouterApiKey?: string;
    model?: string;
    identityName?: string;
    identityDescription?: string;
    goals?: Array<{ id: string; description: string; priority: string; status: string }>;
    schedules?: Array<{ id: string; cron: string; action: string; enabled: boolean }>;
  }
): Promise<AgentWithConfig | null> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  // Update agent fields
  if (updates.name || updates.description !== undefined) {
    updateAgent(agentId, {
      name: updates.name,
      description: updates.description,
    });
  }
  
  // Update config fields
  const configUpdates: Partial<AgentConfig> = {};
  
  if (updates.openrouterApiKey) {
    configUpdates.openrouterKeyEncrypted = await encrypt(updates.openrouterApiKey);
  }
  if (updates.model) {
    configUpdates.model = updates.model;
  }
  if (updates.identityName) {
    configUpdates.identityName = updates.identityName;
  }
  if (updates.identityDescription) {
    configUpdates.identityDescription = updates.identityDescription;
  }
  if (updates.goals) {
    configUpdates.goals = JSON.stringify(updates.goals);
  }
  if (updates.schedules) {
    configUpdates.schedules = JSON.stringify(updates.schedules);
  }
  
  if (Object.keys(configUpdates).length > 0) {
    updateAgentConfig(agentId, configUpdates);
  }
  
  // If container is running, reconfigure it with new settings
  if (agent.containerId && agent.status === 'running') {
    try {
      await reconfigureContainer(agent);
      createActivityLog(agentId, 'agent:reconfigured', { updates: Object.keys(updates) });
    } catch (error) {
      console.error('Failed to reconfigure container:', error);
      // Don't fail the update, just log the error
    }
  } else {
    createActivityLog(agentId, 'agent:updated', { updates: Object.keys(updates) });
  }
  
  return getAgent(agentId, userId);
}

/**
 * Start an agent (create and start container)
 */
export async function startAgent(agentId: string, userId: string): Promise<AgentWithConfig | null> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  updateAgent(agentId, { status: 'starting' });
  
  try {
    if (agent.containerId) {
      // Container exists, just start it
      await startContainer(agent);
    } else {
      // Create new container
      await createContainer(agent);
    }
  } catch (error) {
    updateAgent(agentId, { status: 'error' });
    throw error;
  }
  
  return getAgent(agentId, userId);
}

/**
 * Stop an agent (stop container)
 */
export async function stopAgent(agentId: string, userId: string): Promise<AgentWithConfig | null> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  if (agent.containerId) {
    await stopContainer(agent);
  }
  
  return getAgent(agentId, userId);
}

/**
 * Delete an agent (remove container and database records)
 */
export async function deleteAgentFull(agentId: string, userId: string): Promise<boolean> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return false;
  }
  
  // Remove container if exists
  await removeContainer(agent);
  
  // Delete from database (cascades to config and logs)
  dbDeleteAgent(agentId);
  
  return true;
}

/**
 * Send a message to an agent
 */
export async function sendMessage(
  agentId: string,
  userId: string,
  message: string
): Promise<boolean> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return false;
  }
  
  if (agent.status !== 'running' || !agent.containerId) {
    throw new Error('Agent is not running');
  }
  
  await sendMessageToAgent(agent, message);
  return true;
}

/**
 * Get agent activity logs
 */
export function getAgentLogs(
  agentId: string,
  userId: string,
  limit: number = 100
): ReturnType<typeof getActivityLogs> | null {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  return getActivityLogs(agentId, limit);
}

/**
 * Get container logs for an agent
 */
export async function getAgentContainerLogs(
  agentId: string,
  userId: string,
  tail: number = 100
): Promise<string | null> {
  const agent = getAgentById(agentId);
  
  if (!agent || agent.userId !== userId) {
    return null;
  }
  
  if (!agent.containerId) {
    return null;
  }
  
  return getContainerLogs(agent, tail);
}

/**
 * Update agent heartbeat timestamp
 */
export function updateHeartbeat(agentId: string): void {
  updateAgent(agentId, { lastHeartbeat: Date.now() });
}

/**
 * Get the user's computer (single agent) - creates if doesn't exist
 * Each user gets exactly ONE agent/container = their "computer"
 */
export async function getUserComputer(userId: string, username: string): Promise<AgentWithConfig> {
  // Check if user already has an agent
  const existingAgents = getAgentsByUserId(userId);
  
  if (existingAgents.length > 0) {
    // Return the first (and should be only) agent
    const agent = existingAgents[0];
    const config = getAgentConfig(agent.id);
    const containerInfo = await getContainerInfo(agent);
    
    return {
      ...agent,
      config: config ? {
        agentId: config.agentId,
        model: config.model,
        goals: config.goals,
        schedules: config.schedules,
        identityName: config.identityName,
        identityDescription: config.identityDescription,
      } : undefined,
      containerInfo: containerInfo ? {
        status: containerInfo.status,
        ports: containerInfo.ports,
      } : undefined,
    };
  }
  
  // Create the user's computer (single agent)
  const agent = dbCreateAgent(userId, `${username}'s Computer`, 'Your personal AI computer');
  
  // Create agent config with default model (no API key yet - user will need to add)
  const config = createAgentConfig(
    agent.id,
    '', // Empty key - user needs to configure
    'nvidia/nemotron-nano-9b-v2:free'
  );
  
  // Set default identity
  updateAgentConfig(agent.id, {
    identityName: 'BoneClaw',
    identityDescription: `AI assistant for ${username}. Helpful, autonomous, and always running.`,
  });
  
  createActivityLog(agent.id, 'computer:created', {
    name: agent.name,
    model: config.model,
  });
  
  return {
    ...agent,
    config: {
      agentId: config.agentId,
      model: config.model,
      goals: config.goals,
      schedules: config.schedules,
      identityName: 'BoneClaw',
      identityDescription: `AI assistant for ${username}. Helpful, autonomous, and always running.`,
    },
  };
}
