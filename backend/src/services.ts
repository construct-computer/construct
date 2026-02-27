import { ContainerManager } from './container-manager'
import { BrowserClient } from './browser-client'
import { TerminalServer } from './terminal-server'
import { AgentClient } from './agent-client'

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
  if (tool === 'exec') return 'terminal'
  if (tool === 'read' || tool === 'write' || tool === 'edit' || tool === 'list') return 'editor'
  if (tool === 'file_read' || tool === 'file_write' || tool === 'file_edit') return 'editor'
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

/** Get current desktop state as an array of window types */
export function getDesktopWindows(instanceId: string): DesktopWindowType[] {
  return Array.from(desktopState.get(instanceId) ?? [])
}

/** Update the cached browser state for an instance */
export function updateBrowserCache(instanceId: string, update: Partial<CachedBrowserState>): void {
  const existing = browserStateCache.get(instanceId) ?? {}
  browserStateCache.set(instanceId, { ...existing, ...update })
}

// Helper to check instance ownership
export function checkOwnership(instanceId: string, userId: string): Instance | null {
  const instance = instances.get(instanceId)
  if (!instance) return null
  if (instance.userId !== userId) return null
  return instance
}

/**
 * Initialize all services.
 * Called once at startup.
 */
export async function initializeServices(): Promise<void> {
  console.log('[Services] Initializing...')
  
  await containerManager.initialize()
  await browserClient.initialize()
  
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
