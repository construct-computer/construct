export type AgentStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface Agent {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: AgentStatus;
  containerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  model: string;
  identityName?: string;
  identityDescription?: string;
  goals: AgentGoal[];
  schedules: AgentSchedule[];
}

export interface AgentGoal {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'paused';
}

export interface AgentSchedule {
  id: string;
  cron: string;
  action: string;
  enabled: boolean;
}

export interface AgentWithConfig extends Agent {
  config?: AgentConfig;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  openrouterApiKey: string;
  model?: string;
  identityName?: string;
  identityDescription?: string;
  goals?: AgentGoal[];
  schedules?: AgentSchedule[];
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  openrouterApiKey?: string;
  model?: string;
  identityName?: string;
  identityDescription?: string;
  goals?: AgentGoal[];
  schedules?: AgentSchedule[];
}

export interface ActivityLog {
  id: string;
  agentId: string;
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
}
