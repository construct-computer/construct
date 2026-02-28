import { ContainerManager } from './container-manager'
import { BrowserClient } from './browser-client'
import { TerminalServer } from './terminal-server'
import { AgentClient } from './agent-client'
import { DriveService } from './services/drive-service'
import { DriveSync } from './services/drive-sync'

// Instance type (simplified from production)
export interface Instance {
  id: string
  userId: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  createdAt: Date
}

// Create singleton service instances
export const containerManager = new ContainerManager()
export const browserClient = new BrowserClient(containerManager)
export const terminalServer = new TerminalServer()
export const agentClient = new AgentClient()
export const driveService = new DriveService()
export const driveSync = new DriveSync(driveService, containerManager)

// Track instances in memory (loaded from DB on startup)
export const instances = new Map<string, Instance>()

// Frontend window types (must match frontend WindowType union)
export type DesktopWindowType = 'browser' | 'terminal' | 'editor' | 'files' | 'chat' | 'settings' | 'computer' | 'about' | 'setup'

// Track desktop state per instance (which windows are open).
// Persisted in memory — survives frontend refreshes but not backend restarts.
// Keys are instance IDs, values are sets of open window types.
export const desktopState = new Map<string, Set<DesktopWindowType>>()

// Cache the last browser state per instance so new frontend connections get it immediately.
// Stores the last tabs and status messages from the container's browser-server.
export interface CachedBrowserState {
  tabs?: unknown[]
  url?: string
  title?: string
  activeTabId?: string
}
export const browserStateCache = new Map<string, CachedBrowserState>()

// ── Desktop state helpers ──

/** Map agent tool names to frontend window types */
export function toolToWindowType(tool: string): DesktopWindowType | null {
  // Handle both MCP-style (browser_*) and boneclaw-style (browser) tool names
  if (tool === 'browser' || tool.startsWith('browser_')) return 'browser'
  if (tool === 'web_search') return 'browser' // TinyFish opens in browser view
  if (tool === 'exec') return 'terminal'
  if (tool === 'read' || tool === 'write' || tool === 'edit' || tool === 'list') return 'editor'
  if (tool === 'file_read' || tool === 'file_write' || tool === 'file_edit') return 'editor'
  if (tool === 'google_drive') return 'files'
  return null
}

/** Map desktop_action names to frontend window types */
export function desktopActionToWindowType(action: string): DesktopWindowType | null {
  switch (action) {
    case 'open_terminal': return 'terminal'
    case 'open_browser': return 'browser'
    case 'open_file':
    case 'open_editor': return 'editor'
    case 'open_settings': return 'settings'
    default: return null
  }
}

/** Add a window to the desktop state for an instance */
export function addDesktopWindow(instanceId: string, type: DesktopWindowType): void {
  if (!desktopState.has(instanceId)) desktopState.set(instanceId, new Set())
  desktopState.get(instanceId)!.add(type)
}

/** Remove a window from the desktop state for an instance */
export function removeDesktopWindow(instanceId: string, type: DesktopWindowType): void {
  const set = desktopState.get(instanceId)
  if (set) set.delete(type)
}

/** Get current desktop state as an array of window types */
export function getDesktopWindows(instanceId: string): DesktopWindowType[] {
  return Array.from(desktopState.get(instanceId) ?? [])
}

/** Update the cached browser state for an instance */
export function updateBrowserCache(instanceId: string, update: Partial<CachedBrowserState>): void {
  const existing = browserStateCache.get(instanceId) ?? {}
  browserStateCache.set(instanceId, { ...existing, ...update })
}

// Cache the TinyFish streaming URL per instance so new frontend connections
// can restore the TinyFish overlay without waiting for boneclaw to re-emit.
export const tinyfishStateCache = new Map<string, { streamingUrl: string; lastProgress: string | null }>()

/** Update cached TinyFish streaming state for an instance */
export function updateTinyfishCache(instanceId: string, streamingUrl: string): void {
  const existing = tinyfishStateCache.get(instanceId)
  tinyfishStateCache.set(instanceId, { streamingUrl, lastProgress: existing?.lastProgress ?? null })
}

/** Update cached TinyFish progress for an instance */
export function updateTinyfishProgress(instanceId: string, progress: string): void {
  const existing = tinyfishStateCache.get(instanceId)
  if (existing) existing.lastProgress = progress
}

/** Clear cached TinyFish state for an instance */
export function clearTinyfishCache(instanceId: string): void {
  tinyfishStateCache.delete(instanceId)
}

// Helper to check instance ownership
export function checkOwnership(instanceId: string, userId: string): Instance | null {
  const instance = instances.get(instanceId)
  if (!instance) return null
  if (instance.userId !== userId) return null
  return instance
}

// ── Agent service request handler ──
// Dispatches service requests from boneclaw tools to backend services.

async function handleAgentServiceRequest(
  instanceId: string,
  service: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (service === 'drive') {
    return handleDriveServiceRequest(instanceId, action, params)
  }
  return { success: false, error: `Unknown service: ${service}` }
}

async function handleDriveServiceRequest(
  instanceId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // Resolve instanceId -> userId
  const instance = instances.get(instanceId)
  if (!instance) {
    return { success: false, error: 'Instance not found' }
  }
  const userId = instance.userId

  // Check Drive is configured and connected
  if (!driveService.isConfigured) {
    return { success: false, error: 'Google Drive integration is not configured. The user needs to set up Google Drive in Settings.' }
  }

  const status = await driveService.getStatus(userId)
  if (!status.connected && action !== 'status') {
    return { success: false, error: 'Google Drive is not connected. Ask the user to connect Google Drive in Settings first.' }
  }

  switch (action) {
    case 'status': {
      return { success: true, data: status }
    }

    case 'list': {
      const folderId = (params.folder_id as string) || await driveService.ensureWorkspaceFolder(userId)
      const files = await driveService.listFolder(userId, folderId)
      return { success: true, data: { files, folderId } }
    }

    case 'upload': {
      const filePath = params.file_path as string
      if (!filePath) return { success: false, error: 'file_path is required' }
      const content = await containerManager.readFileBinary(instanceId, filePath)
      const fileName = filePath.split('/').pop() || 'file'
      const parentId = (params.drive_folder_id as string) || await driveService.ensureWorkspaceFolder(userId)
      const fileId = await driveService.uploadFile(userId, parentId, fileName, content)
      const driveLink = `https://drive.google.com/file/d/${fileId}/view`
      return { success: true, data: { fileId, fileName, driveLink } }
    }

    case 'download': {
      const fileId = params.file_id as string
      const destination = params.destination as string
      if (!fileId) return { success: false, error: 'file_id is required' }
      if (!destination) return { success: false, error: 'destination is required' }
      const meta = await driveService.getFileMeta(userId, fileId)
      const content = await driveService.downloadFile(userId, fileId)
      await containerManager.writeFileBinary(instanceId, destination, content)
      return { success: true, data: { fileName: meta.name, size: content.length, destination } }
    }

    case 'search': {
      const query = params.query as string
      if (!query) return { success: false, error: 'query is required' }
      const allFiles = await driveService.listFiles(userId)
      const lowerQuery = query.toLowerCase()
      const matches = allFiles.filter(f => f.name.toLowerCase().includes(lowerQuery))
      return {
        success: true,
        data: {
          files: matches.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            mimeType: f.mimeType,
            size: f.size,
            modifiedTime: f.modifiedTime,
            isFolder: f.isFolder,
          })),
        },
      }
    }

    default:
      return { success: false, error: `Unknown drive action: ${action}` }
  }
}

/**
 * Initialize all services.
 * Called once at startup.
 */
export async function initializeServices(): Promise<void> {
  console.log('[Services] Initializing...')
  
  await containerManager.initialize()
  await browserClient.initialize()

  // Wire up service request handler so boneclaw tools can access backend services
  agentClient.setServiceRequestHandler(handleAgentServiceRequest)
  
  console.log('[Services] Initialization complete')
}

/**
 * Shutdown all services gracefully.
 */
export async function shutdownServices(): Promise<void> {
  console.log('[Services] Shutting down...')
  
  agentClient.shutdown()
  terminalServer.shutdown()
  await browserClient.shutdown()
  // Don't shutdown containerManager - let containers keep running
  
  console.log('[Services] Shutdown complete')
}
