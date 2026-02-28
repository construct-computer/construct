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

/**
 * Load conversation history from the agent (persisted inside the container).
 */
export async function getAgentHistory(instanceId: string, sessionKey = 'ws_default'): Promise<ApiResult<{
  session_key: string;
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{
      type: string;
      function: { name: string; arguments: string };
    }>;
  }>;
}>> {
  return request(`/instances/${instanceId}/agent/history?session_key=${encodeURIComponent(sessionKey)}`);
}

export interface SessionInfo {
  key: string;
  title: string;
  created: number;
  lastActivity: number;
}

/**
 * List all chat sessions for the agent.
 */
export async function getAgentSessions(instanceId: string): Promise<ApiResult<{
  sessions: SessionInfo[];
  active_key: string;
}>> {
  return request(`/instances/${instanceId}/agent/sessions`);
}

/**
 * Create a new chat session.
 */
export async function createAgentSession(instanceId: string, title?: string): Promise<ApiResult<SessionInfo>> {
  return request(`/instances/${instanceId}/agent/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

/**
 * Delete a chat session.
 */
export async function deleteAgentSession(instanceId: string, sessionKey: string): Promise<ApiResult<{ ok: boolean; active_key: string }>> {
  return request(`/instances/${instanceId}/agent/sessions/${encodeURIComponent(sessionKey)}`, {
    method: 'DELETE',
  });
}

/**
 * Rename a chat session.
 */
export async function renameAgentSession(instanceId: string, sessionKey: string, title: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/instances/${instanceId}/agent/sessions/${encodeURIComponent(sessionKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

/**
 * Switch the active chat session.
 */
export async function activateAgentSession(instanceId: string, sessionKey: string): Promise<ApiResult<{ ok: boolean; active_key: string }>> {
  return request(`/instances/${instanceId}/agent/sessions/${encodeURIComponent(sessionKey)}/activate`, {
    method: 'PUT',
  });
}

/**
 * Validate an OpenRouter API key by calling their auth endpoint.
 * Returns { valid: true } on success, or { valid: false, error } on failure.
 */
export async function validateOpenRouterKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) return { valid: true };
    if (response.status === 401) return { valid: false, error: 'Invalid API key' };
    return { valid: false, error: `Validation failed (${response.status})` };
  } catch {
    return { valid: false, error: 'Could not validate key. Check your connection.' };
  }
}

/**
 * Fetch model info (name + pricing) from OpenRouter.
 * Uses the public /api/v1/models endpoint (no auth required).
 */
export interface OpenRouterModelInfo {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string } | null;
}

const modelInfoCache = new Map<string, OpenRouterModelInfo | null>();

export async function fetchModelInfo(modelId: string): Promise<OpenRouterModelInfo | null> {
  if (modelInfoCache.has(modelId)) return modelInfoCache.get(modelId)!;

  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models`);
    if (!res.ok) return null;

    const data = await res.json() as { data: Array<{ id: string; name: string; pricing?: { prompt?: string; completion?: string } }> };
    // Cache all models from the response for future lookups
    for (const m of data.data) {
      const info: OpenRouterModelInfo = {
        id: m.id,
        name: m.name,
        pricing: m.pricing ? { prompt: m.pricing.prompt || '0', completion: m.pricing.completion || '0' } : null,
      };
      modelInfoCache.set(m.id, info);
    }

    return modelInfoCache.get(modelId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Format per-token pricing to a human-readable $/M tokens string.
 */
export function formatModelPrice(perToken: string): string {
  const n = parseFloat(perToken);
  if (isNaN(n) || n === 0) return 'Free';
  const perMillion = n * 1_000_000;
  if (perMillion < 0.01) return `<$0.01/M`;
  if (perMillion < 1) return `$${perMillion.toFixed(2)}/M`;
  return `$${perMillion.toFixed(perMillion % 1 === 0 ? 0 : 2)}/M`;
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

// ============================================================================
// Filesystem API
// ============================================================================

export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: string;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

export async function listFiles(instanceId: string, path = '/home/sandbox/workspace'): Promise<ApiResult<FileListResponse>> {
  return request(`/instances/${instanceId}/files?path=${encodeURIComponent(path)}`);
}

export interface FileContentResponse {
  path: string;
  content: string;
}

export async function readFile(instanceId: string, path: string): Promise<ApiResult<FileContentResponse>> {
  return request(`/instances/${instanceId}/files/read?path=${encodeURIComponent(path)}`);
}

/**
 * Download a binary file from the container. Returns the raw Response
 * so the caller can create a blob URL for preview.
 */
export async function downloadContainerFile(instanceId: string, path: string): Promise<Response> {
  const token = getToken();
  return fetch(`${API_BASE_URL}/instances/${instanceId}/files/download?path=${encodeURIComponent(path)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function writeFile(instanceId: string, path: string, content: string): Promise<ApiResult<{ status: string; path: string }>> {
  return request(`/instances/${instanceId}/files/write`, {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function createFile(instanceId: string, path: string): Promise<ApiResult<{ status: string; path: string }>> {
  return request(`/instances/${instanceId}/files/create`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function createDirectory(instanceId: string, path: string): Promise<ApiResult<{ status: string; path: string }>> {
  return request(`/instances/${instanceId}/files/mkdir`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function deleteItem(instanceId: string, path: string): Promise<ApiResult<{ status: string; path: string }>> {
  return request(`/instances/${instanceId}/files/delete`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function renameItem(instanceId: string, oldPath: string, newPath: string): Promise<ApiResult<{ status: string; oldPath: string; newPath: string }>> {
  return request(`/instances/${instanceId}/files/rename`, {
    method: 'POST',
    body: JSON.stringify({ oldPath, newPath }),
  });
}

// ============================================================================
// Google Drive API
// ============================================================================

export interface DriveStatus {
  connected: boolean;
  email?: string;
  lastSync?: string;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified?: string;
  mimeType: string;
}

export interface DriveSyncReport {
  downloaded: string[];
  uploaded: string[];
  deleted: string[];
  conflicts: string[];
  timestamp: string;
}

export async function getDriveConfigured(): Promise<ApiResult<{ configured: boolean }>> {
  return request('/drive/configured');
}

export async function getDriveAuthUrl(): Promise<ApiResult<{ url?: string; error?: string }>> {
  return request('/drive/auth-url');
}

export async function getDriveStatus(): Promise<ApiResult<DriveStatus>> {
  return request('/drive/status');
}

export async function disconnectDrive(): Promise<ApiResult<{ status: string }>> {
  return request('/drive/disconnect', { method: 'DELETE' });
}

export async function listDriveFiles(folderId?: string): Promise<ApiResult<{ files: DriveFileEntry[]; folderId: string }>> {
  const query = folderId ? `?folderId=${folderId}` : '';
  return request(`/drive/files${query}`);
}

export async function readDriveFileContent(fileId: string): Promise<ApiResult<{ content: string }>> {
  return request(`/drive/files/${fileId}/content`);
}

export async function downloadDriveFile(fileId: string): Promise<Response> {
  const token = getToken();
  return fetch(`${API_BASE_URL}/drive/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function deleteDriveFile(fileId: string): Promise<ApiResult<{ status: string }>> {
  return request(`/drive/files/${fileId}`, { method: 'DELETE' });
}

export async function createDriveFolder(name: string, parentFolderId?: string): Promise<ApiResult<{ status: string; folderId: string }>> {
  return request('/drive/mkdir', {
    method: 'POST',
    body: JSON.stringify({ name, parentFolderId }),
  });
}

export async function copyToDrive(instanceId: string, filePath: string, driveFolderId?: string): Promise<ApiResult<{ status: string; fileId: string }>> {
  return request(`/drive/copy-to-drive/${instanceId}`, {
    method: 'POST',
    body: JSON.stringify({ filePath, driveFolderId }),
  });
}

export async function copyToLocal(instanceId: string, driveFileId: string, containerPath: string): Promise<ApiResult<{ status: string }>> {
  return request(`/drive/copy-to-local/${instanceId}`, {
    method: 'POST',
    body: JSON.stringify({ driveFileId, containerPath }),
  });
}

export async function syncDrive(instanceId: string): Promise<ApiResult<DriveSyncReport>> {
  return request(`/drive/sync/${instanceId}`, { method: 'POST' });
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
      model: 'nvidia/nemotron-3-nano-30b-a3b:free',
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
