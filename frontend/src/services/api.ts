import { API_BASE_URL, STORAGE_KEYS } from '@/lib/constants';
import type { ApiResult, User, AuthResponse, Agent, AgentWithConfig, UpdateAgentRequest, ActivityLog } from '@/types';

// Re-export types for convenience
export type { UpdateAgentRequest };

/**
 * Get the auth token from storage
 */
function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.token);
}

/**
 * Set the auth token in storage
 */
export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.token, token);
}

/**
 * Clear the auth token from storage
 */
export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEYS.token);
}

/**
 * Make an authenticated API request
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const token = getToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
    
    // Try to parse as JSON, handle non-JSON responses gracefully
    let data: Record<string, unknown>;
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      // Non-JSON response - try to get text for error message
      const text = await response.text();
      if (!response.ok) {
        return { success: false, error: text || `Request failed (${response.status})` };
      }
      // If somehow OK but not JSON, treat as empty
      data = {};
    }
    
    if (!response.ok) {
      return { success: false, error: (data.error as string) || `Request failed (${response.status})` };
    }
    
    return { success: true, data: data as T };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ============================================================================
// Auth API
// ============================================================================

export async function login(username: string, password: string): Promise<ApiResult<AuthResponse>> {
  const result = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  if (result.success) {
    setToken(result.data.token);
  }
  
  return result;
}

export async function register(username: string, password: string): Promise<ApiResult<AuthResponse>> {
  const result = await request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  if (result.success) {
    setToken(result.data.token);
  }
  
  return result;
}

export async function getMe(): Promise<ApiResult<{ user: User }>> {
  return request('/auth/me');
}

export async function refreshToken(): Promise<ApiResult<AuthResponse>> {
  const result = await request<AuthResponse>('/auth/refresh', {
    method: 'POST',
  });
  
  if (result.success) {
    setToken(result.data.token);
  }
  
  return result;
}

export function logout(): void {
  clearToken();
}

// ============================================================================
// Instance API (single computer per user)
// ============================================================================

export interface Instance {
  id: string;
  userId: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  createdAt: string;
}

export interface ContainerInfo {
  id: string;
  instanceId: string;
  status: string;
  ports: {
    http: number;
    browser: number;
    agent: number;
  };
  createdAt: string;
}

export interface AgentConfigResponse {
  openrouter_api_key: string;
  telegram_bot_token: string;
  model: string;
  has_api_key: boolean;
  has_telegram_token: boolean;
}

export async function getInstance(): Promise<ApiResult<{ instance: Instance; container: ContainerInfo }>> {
  return request('/instances/me');
}

export async function rebootInstance(instanceId: string): Promise<ApiResult<{ status: string; container: ContainerInfo }>> {
  return request(`/instances/${instanceId}/reboot`, { method: 'POST' });
}

export async function getAgentConfig(instanceId: string): Promise<ApiResult<AgentConfigResponse>> {
  return request(`/instances/${instanceId}/agent/config`);
}

export async function updateAgentConfig(instanceId: string, config: {
  openrouter_api_key?: string;
  telegram_bot_token?: string;
  model?: string;
}): Promise<ApiResult<{ status: string; message: string }>> {
  return request(`/instances/${instanceId}/agent/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function getAgentStatus(instanceId: string): Promise<ApiResult<{
  running: boolean;
  model: string;
  provider: string;
  session_count: number;
  uptime_seconds: number;
  connected: boolean;
}>> {
  return request(`/instances/${instanceId}/agent/status`);
}

export interface AgentConfigStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
}

export async function getAgentConfigStatus(instanceId: string): Promise<ApiResult<AgentConfigStatus>> {
  return request(`/instances/${instanceId}/agent/config/status`);
}

export async function chatWithAgent(instanceId: string, message: string): Promise<ApiResult<{
  response: string;
  session_key: string;
}>> {
  return request(`/instances/${instanceId}/agent/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export interface DesktopState {
  windows: string[];
  browser: {
    tabs?: unknown[];
    url?: string;
    title?: string;
    activeTabId?: string;
  } | null;
}

export async function getDesktopState(instanceId: string): Promise<ApiResult<DesktopState>> {
  return request(`/instances/${instanceId}/desktop/state`);
}

// Legacy function for compatibility
export async function getComputer(): Promise<ApiResult<{ computer: AgentWithConfig }>> {
  // Map instance to legacy "computer" format
  const result = await getInstance();
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  const { instance, container } = result.data;
  const computer: AgentWithConfig = {
    id: instance.id,
    userId: instance.userId,
    name: 'My Computer',
    description: 'Your personal AI computer',
    status: instance.status as AgentWithConfig['status'],
    containerId: container?.id,
    createdAt: instance.createdAt,
    updatedAt: instance.createdAt,
    config: {
      model: 'nvidia/nemotron-nano-9b-v2:free',
      goals: [],
      schedules: [],
      identityName: 'BoneClaw Agent',
      identityDescription: 'Your AI assistant',
    },
  };
  
  return { success: true, data: { computer } };
}

// ============================================================================
// Agents API (deprecated - for compatibility)
// ============================================================================

export async function getAgents(): Promise<ApiResult<{ agents: Agent[] }>> {
  return request('/agents');
}

export async function getAgent(id: string): Promise<ApiResult<{ agent: AgentWithConfig }>> {
  return request(`/agents/${id}`);
}

export async function updateAgent(id: string, data: UpdateAgentRequest): Promise<ApiResult<{ agent: Agent }>> {
  return request(`/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function startAgent(id: string): Promise<ApiResult<{ agent: Agent }>> {
  return request(`/agents/${id}/start`, {
    method: 'POST',
  });
}

export async function stopAgent(id: string): Promise<ApiResult<{ agent: Agent }>> {
  return request(`/agents/${id}/stop`, {
    method: 'POST',
  });
}

export async function sendAgentMessage(id: string, message: string): Promise<ApiResult<{ success: boolean }>> {
  return request(`/agents/${id}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function getAgentActivity(id: string, limit = 100): Promise<ApiResult<{ logs: ActivityLog[] }>> {
  return request(`/agents/${id}/activity?limit=${limit}`);
}

export async function getAgentLogs(id: string, tail = 100): Promise<ApiResult<{ logs: string }>> {
  return request(`/agents/${id}/logs?tail=${tail}`);
}
