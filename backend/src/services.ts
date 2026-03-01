import { ContainerManager } from './container-manager'
import { BrowserClient } from './browser-client'
import { TerminalServer } from './terminal-server'
import { AgentClient } from './agent-client'
import { DriveService } from './services/drive-service'
import { DriveSync } from './services/drive-sync'
import { SlackManager } from './services/slack-manager'
import { getSlackInstallationByUser } from './db/client'

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
export const slackManager = new SlackManager()

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
  if (tool === 'email') return 'chat'
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
  if (service === 'slack') {
    return handleSlackServiceRequest(instanceId, action, params)
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

async function handleSlackServiceRequest(
  instanceId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // Resolve instanceId → userId → installation → WebClient
  const instance = instances.get(instanceId)
  if (!instance) {
    return { success: false, error: 'Instance not found' }
  }
  const userId = instance.userId

  if (!slackManager.isConfigured) {
    return { success: false, error: 'Slack integration is not configured on this server.' }
  }

  const installation = getSlackInstallationByUser(userId)
  if (!installation && action !== 'status') {
    return { success: false, error: 'Slack is not connected. Ask the user to connect Slack in Settings first.' }
  }

  const teamId = installation?.teamId
  const webClient = teamId ? slackManager.getWebClient(teamId) : undefined

  try {
    switch (action) {
      case 'status': {
        if (!installation) {
          return { success: true, data: { connected: false } }
        }
        return {
          success: true,
          data: {
            connected: true,
            teamName: installation.teamName,
            teamId: installation.teamId,
          },
        }
      }

      case 'list_channels': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const limit = (params.limit as number) || 100
        const result = await webClient.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit,
        })
        const channels = (result.channels || []).map((ch) => {
          const c = ch as unknown as Record<string, unknown>
          return {
            id: c.id,
            name: c.name,
            is_private: c.is_private,
            num_members: c.num_members,
            topic: (c.topic as Record<string, unknown>)?.value || '',
            purpose: (c.purpose as Record<string, unknown>)?.value || '',
          }
        })
        return { success: true, data: { channels } }
      }

      case 'list_members': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const channelId = await resolveChannel(webClient, params.channel as string)
        if (!channelId) return { success: false, error: `Channel "${params.channel}" not found` }

        const membersResult = await webClient.conversations.members({ channel: channelId })
        const memberIds = membersResult.members || []

        // Fetch user info for each member (batch)
        const members = await Promise.all(
          memberIds.slice(0, 100).map(async (id: string) => {
            try {
              const info = await webClient.users.info({ user: id })
              const u = info.user as Record<string, unknown>
              const profile = u?.profile as Record<string, unknown> || {}
              return {
                id: u?.id,
                name: u?.name,
                real_name: u?.real_name || profile.real_name,
                title: profile.title || '',
                is_bot: u?.is_bot,
              }
            } catch {
              return { id, name: id, real_name: 'Unknown', title: '', is_bot: false }
            }
          })
        )
        // Get channel name for formatting
        const channelName = typeof params.channel === 'string' && !params.channel.startsWith('C')
          ? params.channel : undefined
        return { success: true, data: { members, channel_name: channelName } }
      }

      case 'get_channel_info': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const chId = await resolveChannel(webClient, params.channel as string)
        if (!chId) return { success: false, error: `Channel "${params.channel}" not found` }

        const info = await webClient.conversations.info({ channel: chId })
        const ch = info.channel as Record<string, unknown>
        return {
          success: true,
          data: {
            channel: {
              id: ch.id,
              name: ch.name,
              num_members: ch.num_members,
              topic: (ch.topic as Record<string, unknown>)?.value || '',
              purpose: (ch.purpose as Record<string, unknown>)?.value || '',
              is_private: ch.is_private,
              created: ch.created,
            },
          },
        }
      }

      case 'get_user_info': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const userId2 = await resolveUser(webClient, params.user as string)
        if (!userId2) return { success: false, error: `User "${params.user}" not found` }

        const info = await webClient.users.info({ user: userId2 })
        const u = info.user as Record<string, unknown>
        const profile = u?.profile as Record<string, unknown> || {}
        return {
          success: true,
          data: {
            user: {
              id: u?.id,
              name: u?.name,
              real_name: u?.real_name || profile.real_name,
              title: profile.title || '',
              email: profile.email || '',
              tz: u?.tz,
              is_bot: u?.is_bot,
              status_text: profile.status_text || '',
              status_emoji: profile.status_emoji || '',
            },
          },
        }
      }

      case 'read_history': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const histChannelId = await resolveChannel(webClient, params.channel as string)
        if (!histChannelId) return { success: false, error: `Channel "${params.channel}" not found` }

        const limit = (params.limit as number) || 20
        const histParams: Record<string, unknown> = {
          channel: histChannelId,
          limit,
        }
        if (params.thread_ts) {
          // Read thread replies
          const replies = await webClient.conversations.replies({
            channel: histChannelId,
            ts: params.thread_ts as string,
            limit,
          })
          const messages = await enrichMessages(webClient, replies.messages || [])
          return { success: true, data: { messages, channel_name: params.channel } }
        }

        const history = await webClient.conversations.history(histParams as unknown as Parameters<typeof webClient.conversations.history>[0])
        const messages = await enrichMessages(webClient, (history.messages || []).reverse())
        const channelName = typeof params.channel === 'string' && !params.channel.startsWith('C')
          ? params.channel : undefined
        return { success: true, data: { messages, channel_name: channelName } }
      }

      case 'send_message': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const sendChannelId = await resolveChannel(webClient, params.channel as string)
        if (!sendChannelId) return { success: false, error: `Channel "${params.channel}" not found` }

        const text = params.text as string
        if (!text) return { success: false, error: 'text is required' }

        const msgParams: Record<string, unknown> = {
          channel: sendChannelId,
          text,
        }
        if (params.thread_ts) {
          msgParams.thread_ts = params.thread_ts
        }
        const result = await webClient.chat.postMessage(msgParams as unknown as Parameters<typeof webClient.chat.postMessage>[0])
        return {
          success: true,
          data: {
            channel: params.channel,
            ts: result.ts,
            thread_ts: params.thread_ts,
          },
        }
      }

      case 'add_reaction': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const reactChannelId = await resolveChannel(webClient, params.channel as string)
        if (!reactChannelId) return { success: false, error: `Channel "${params.channel}" not found` }

        const emoji = params.emoji as string
        const timestamp = params.timestamp as string
        if (!emoji || !timestamp) return { success: false, error: 'emoji and timestamp are required' }

        await webClient.reactions.add({
          channel: reactChannelId,
          timestamp,
          name: emoji,
        })
        return { success: true, data: {} }
      }

      case 'upload_file': {
        if (!webClient) return { success: false, error: 'No Slack connection' }
        const uploadChannelId = await resolveChannel(webClient, params.channel as string)
        if (!uploadChannelId) return { success: false, error: `Channel "${params.channel}" not found` }

        const filePath = params.file_path as string
        if (!filePath) return { success: false, error: 'file_path is required' }

        // Read file from container via containerManager
        const fileBuffer = await containerManager.readFileBinary(instanceId, filePath)
        const fileName = filePath.split('/').pop() || 'file'

        await webClient.filesUploadV2({
          channel_id: uploadChannelId,
          file: fileBuffer,
          filename: fileName,
          title: fileName,
          initial_comment: (params.text as string) || undefined,
        })
        return { success: true, data: {} }
      }

      default:
        return { success: false, error: `Unknown slack action: ${action}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Slack] Service request ${action} failed:`, message)
    return { success: false, error: message }
  }
}

// ── Slack helpers ──

// Cache: channel name → channel ID (per-session, not persisted)
const channelNameCache = new Map<string, string>()

/**
 * Resolve a channel name or ID to a channel ID.
 */
async function resolveChannel(webClient: import('@slack/web-api').WebClient, channel: string): Promise<string | null> {
  if (!channel) return null
  // Already an ID (starts with C, G, or D)
  if (/^[CGD][A-Z0-9]+$/.test(channel)) return channel

  // Check cache
  const cached = channelNameCache.get(channel.toLowerCase())
  if (cached) return cached

  // Look up by name
  try {
    const result = await webClient.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
    })
    for (const ch of (result.channels || [])) {
      const name = (ch as Record<string, unknown>).name as string
      const id = (ch as Record<string, unknown>).id as string
      if (name) channelNameCache.set(name.toLowerCase(), id)
    }
    return channelNameCache.get(channel.toLowerCase()) || null
  } catch {
    return null
  }
}

/**
 * Resolve a user name or ID to a user ID.
 */
async function resolveUser(webClient: import('@slack/web-api').WebClient, user: string): Promise<string | null> {
  if (!user) return null
  // Already an ID
  if (/^[UW][A-Z0-9]+$/.test(user)) return user

  // Look up by name
  try {
    const result = await webClient.users.list({ limit: 1000 })
    for (const member of (result.members || [])) {
      const m = member as Record<string, unknown>
      if ((m.name as string)?.toLowerCase() === user.toLowerCase() ||
          (m.real_name as string)?.toLowerCase() === user.toLowerCase()) {
        return m.id as string
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Enrich raw Slack messages with user names and formatted timestamps.
 */
async function enrichMessages(
  webClient: import('@slack/web-api').WebClient,
  messages: unknown[],
): Promise<Array<Record<string, unknown>>> {
  const userCache = new Map<string, string>()

  return Promise.all(
    messages.map(async (msg) => {
      const m = msg as Record<string, unknown>
      const userId = m.user as string
      let userName = userId

      if (userId && !userCache.has(userId)) {
        try {
          const info = await webClient.users.info({ user: userId })
          const name = (info.user as Record<string, unknown>)?.real_name as string
            || (info.user as Record<string, unknown>)?.name as string
            || userId
          userCache.set(userId, name)
        } catch {
          userCache.set(userId, userId)
        }
      }
      if (userId) userName = userCache.get(userId) || userId

      // Format timestamp
      const ts = m.ts as string
      const time = ts ? new Date(parseFloat(ts) * 1000).toLocaleString() : ''

      return {
        user: userId,
        user_name: userName,
        text: m.text,
        ts,
        time,
        thread_ts: m.thread_ts,
        reply_count: m.reply_count,
      }
    })
  )
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

  // Initialize Slack manager (it will start Socket Mode if configured)
  slackManager.initialize(agentClient, instances)
  await slackManager.start()
  
  console.log('[Services] Initialization complete')
}

/**
 * Shutdown all services gracefully.
 */
export async function shutdownServices(): Promise<void> {
  console.log('[Services] Shutting down...')
  
  await slackManager.shutdown()
  agentClient.shutdown()
  terminalServer.shutdown()
  await browserClient.shutdown()
  // Don't shutdown containerManager - let containers keep running
  
  console.log('[Services] Shutdown complete')
}
