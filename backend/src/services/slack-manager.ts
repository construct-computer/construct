import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import { nanoid } from 'nanoid'
import { config } from '../config'
import {
  getSlackInstallationByTeam,
  getAllSlackInstallations,
  getSlackThreadSession,
  saveSlackThreadSession,
  deleteSlackInstallation,
} from '../db/client'
import type { AgentClient } from '../agent-client'
import type { Instance } from '../services'

/**
 * SlackManager handles Socket Mode connections and routes Slack events
 * to the appropriate boneclaw agent via agentClient.sendMessage().
 *
 * Architecture:
 *  - One Socket Mode connection using the app-level token (xapp-...)
 *  - Per-workspace bot tokens (xoxb-...) stored in DB for API calls
 *  - Events come in via Socket Mode → look up team → resolve user → send to agent
 */
export class SlackManager {
  private socketClient: SocketModeClient | null = null
  private agentClient: AgentClient | null = null
  private instances: Map<string, Instance> | null = null
  private webClients = new Map<string, WebClient>() // teamId → WebClient

  get isConfigured(): boolean {
    return !!(config.slackClientId && config.slackClientSecret && config.slackAppToken)
  }

  /**
   * Initialize the Slack manager with references to shared services.
   * Must be called before start().
   */
  initialize(agentClient: AgentClient, instances: Map<string, Instance>): void {
    this.agentClient = agentClient
    this.instances = instances
  }

  /**
   * Start the Socket Mode connection if configured.
   * Loads existing installations and sets up event handlers.
   */
  async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log('[Slack] Not configured (missing SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, or SLACK_APP_TOKEN)')
      return
    }

    // Pre-create WebClients for existing installations
    const installations = getAllSlackInstallations()
    for (const inst of installations) {
      this.webClients.set(inst.teamId, new WebClient(inst.botToken))
    }
    console.log(`[Slack] Loaded ${installations.length} existing installation(s)`)

    // Create Socket Mode client with the app-level token
    this.socketClient = new SocketModeClient({
      appToken: config.slackAppToken,
      logLevel: config.isDev ? undefined : undefined, // use defaults
    })

    // Register event handlers
    this.socketClient.on('app_mention', async ({ event, ack }) => {
      await ack()
      await this.handleMention(event)
    })

    this.socketClient.on('message', async ({ event, ack }) => {
      await ack()
      // Only handle DMs (im channel type). Channel messages require @mention.
      if (event.channel_type === 'im') {
        await this.handleDirectMessage(event)
      }
    })

    // Start the connection
    try {
      await this.socketClient.start()
      console.log('[Slack] Socket Mode connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Slack] Failed to start Socket Mode:', msg)
    }
  }

  /**
   * Register a new installation's WebClient (called after OAuth completes).
   */
  registerInstallation(teamId: string, botToken: string): void {
    this.webClients.set(teamId, new WebClient(botToken))
    console.log(`[Slack] Registered WebClient for team ${teamId}`)
  }

  /**
   * Remove a team's WebClient (called when user disconnects).
   */
  unregisterInstallation(teamId: string): void {
    this.webClients.delete(teamId)
    deleteSlackInstallation(teamId)
    console.log(`[Slack] Unregistered team ${teamId}`)
  }

  /**
   * Get the WebClient for a specific team (used by service request handler).
   */
  getWebClient(teamId: string): WebClient | undefined {
    return this.webClients.get(teamId)
  }

  /**
   * Gracefully shut down Socket Mode connection.
   */
  async shutdown(): Promise<void> {
    if (this.socketClient) {
      try {
        await this.socketClient.disconnect()
      } catch {
        // ignore disconnect errors
      }
      this.socketClient = null
    }
    this.webClients.clear()
    console.log('[Slack] Shut down')
  }

  // ── Event Handlers ──

  private async handleMention(event: Record<string, unknown>): Promise<void> {
    const teamId = event.team as string
    const channelId = event.channel as string
    const text = event.text as string
    const user = event.user as string
    const ts = event.ts as string
    const threadTs = (event.thread_ts as string) || ts // If not in a thread, message ts becomes the thread root

    await this.processMessage(teamId, channelId, text, user, ts, threadTs)
  }

  private async handleDirectMessage(event: Record<string, unknown>): Promise<void> {
    const teamId = event.team as string
    const channelId = event.channel as string
    const text = event.text as string
    const user = event.user as string
    const ts = event.ts as string
    const threadTs = (event.thread_ts as string) || ts

    // Ignore bot's own messages
    if (event.bot_id || event.subtype === 'bot_message') return

    await this.processMessage(teamId, channelId, text, user, ts, threadTs)
  }

  private async processMessage(
    teamId: string,
    channelId: string,
    rawText: string,
    slackUserId: string,
    messageTs: string,
    threadTs: string,
  ): Promise<void> {
    if (!this.agentClient || !this.instances) return

    // Look up installation
    const installation = getSlackInstallationByTeam(teamId)
    if (!installation) {
      console.warn(`[Slack] No installation found for team ${teamId}`)
      return
    }

    const webClient = this.webClients.get(teamId)
    if (!webClient) return

    // Resolve our userId → instanceId (they're the same)
    const userId = installation.userId
    const instanceId = userId

    // Check instance is running
    const instance = this.instances.get(instanceId)
    if (!instance || instance.status !== 'running') {
      await webClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, the agent is not currently running. Please start it from construct.computer first.',
      })
      return
    }

    // Strip bot mention from text
    const cleanText = this.stripMention(rawText, installation.botUserId)
    if (!cleanText.trim()) return // Empty message after stripping mention

    // Resolve Slack username and channel name for context
    let username = 'Someone'
    let slackHandle = ''
    try {
      const userInfo = await webClient.users.info({ user: slackUserId })
      const u = userInfo.user as Record<string, unknown>
      username = (u?.real_name as string) || (u?.name as string) || 'Someone'
      slackHandle = (u?.name as string) || ''
    } catch {
      // Fall back to generic
    }

    let channelName = channelId
    try {
      const channelInfo = await webClient.conversations.info({ channel: channelId })
      const ch = channelInfo.channel as Record<string, unknown>
      channelName = (ch?.name as string) || channelId
    } catch {
      // DMs may not have a name
    }

    // Add thinking reaction
    try {
      await webClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand',
      })
    } catch {
      // Reaction may fail if already added
    }

    // Determine session key from thread
    let sessionKey: string
    const existingSession = getSlackThreadSession(teamId, channelId, threadTs)
    if (existingSession) {
      sessionKey = existingSession.sessionKey
    } else {
      // New thread = new boneclaw session
      sessionKey = `slack_${nanoid(12)}`
      saveSlackThreadSession({ teamId, channelId, threadTs, sessionKey })
    }

    // Format message with rich context so the agent can use the slack tool
    const formattedMessage =
      `[Slack #${channelName} | ${username}${slackHandle ? ` (@${slackHandle})` : ''} | user_id: ${slackUserId} | channel: ${channelId} | thread: ${threadTs}]: ${cleanText}`

    try {
      // Send to boneclaw agent
      const response = await this.agentClient.sendMessage(instanceId, formattedMessage, sessionKey)

      // Remove thinking reaction
      try {
        await webClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'hourglass_flowing_sand',
        })
      } catch {
        // ignore
      }

      // Convert markdown to Slack mrkdwn and send reply
      const slackText = markdownToMrkdwn(response)

      // Split long messages (Slack limit ~4000 chars, we use 3000 to be safe)
      const chunks = splitMessage(slackText, 3000)
      for (const chunk of chunks) {
        await webClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: chunk,
        })
      }
    } catch (err) {
      // Remove thinking reaction on error too
      try {
        await webClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'hourglass_flowing_sand',
        })
      } catch {
        // ignore
      }

      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[Slack] Agent message failed for team ${teamId}:`, errorMsg)

      await webClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Sorry, I encountered an error: ${errorMsg.slice(0, 200)}`,
      })
    }
  }

  /**
   * Strip the bot mention from the beginning of a message.
   * Slack mentions look like: <@U12345> some text
   */
  private stripMention(text: string, botUserId: string): string {
    // Remove <@BOT_USER_ID> pattern
    const mentionRegex = new RegExp(`<@${botUserId}>\\s*`, 'g')
    return text.replace(mentionRegex, '').trim()
  }
}

// ── Markdown → Slack mrkdwn Conversion ──

/**
 * Convert standard Markdown to Slack's mrkdwn format.
 */
export function markdownToMrkdwn(md: string): string {
  let text = md

  // Headers: ## Title → *Title*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  // Bold: **text** → *text*
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*')

  // Italic: _text_ stays the same in mrkdwn, but *text* (single asterisk) from markdown → _text_
  // We need to handle this carefully since we just converted bold
  // Standard markdown italic with underscores is already valid mrkdwn

  // Links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  // Inline code: `code` stays the same
  // Code blocks: ```lang\n...\n``` → ```\n...\n``` (strip language hint)
  text = text.replace(/```\w*\n/g, '```\n')

  // Unordered lists: - item → • item
  text = text.replace(/^[-*]\s+/gm, '• ')

  // Strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~')

  // Horizontal rules
  text = text.replace(/^---+$/gm, '───────────────')

  return text
}

/**
 * Split a message into chunks that fit within Slack's message limit.
 * Tries to split at paragraph boundaries, then newlines, then word boundaries.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Try to split at paragraph break
    let splitAt = remaining.lastIndexOf('\n\n', maxLength)
    if (splitAt < maxLength * 0.3) {
      // Try newline
      splitAt = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitAt < maxLength * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitAt < maxLength * 0.3) {
      // Hard cut
      splitAt = maxLength
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
