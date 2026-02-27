import { execFileSync } from 'child_process'
import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { getUser } from '../services/auth.service'
import { 
  containerManager, browserClient, agentClient, terminalServer, instances,
  getDesktopWindows, browserStateCache,
  type Instance 
} from '../services'
import type { AgentConfig } from '../agent-client'

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production'

// System prompt that tells the agent about the construct.computer platform.
const SYSTEM_PROMPT = `You are BoneClaw, an AI agent operating a virtual desktop computer visible to the user. Everything you do must happen through the desktop apps (browser, terminal, editor) — never use invisible tools like curl or wget. The user is watching your screen.

When searching the web, always use Brave Search (https://search.brave.com/search?q=...) instead of Google.

Call tools immediately without explaining what you're about to do.

## Browser workflow
Use browser_snapshot to see the page. It returns an accessibility tree with element refs like @e1, @e2, etc. Use these refs with browser_click, browser_fill, browser_hover, and browser_select for precise, reliable interaction — refs are much more reliable than coordinate-based clicking.

Typical flow:
1. browser_navigate to go to a URL
2. browser_snapshot to see what's on the page
3. browser_click with a ref (e.g. "@e5") to click a button or link
4. browser_fill with a ref and text to fill an input field
5. browser_snapshot again to see the result

Use browser_press for keyboard shortcuts (e.g. "Enter", "Tab", "Control+a"). Use browser_scroll to scroll the page. Use browser_wait when you need to wait for content to load.`

/**
 * Generate a boneclaw YAML config with the provided settings.
 */
function generateBoneclawConfig(config: AgentConfig): string {
  const openrouterKey = config.openrouter_api_key || ''
  const model = config.model || ''
  const telegramToken = config.telegram_bot_token || ''

  // Escape YAML special chars in strings
  const escapeYaml = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  // Escape for YAML block scalar
  const indentForYaml = (s: string, spaces: number) => {
    const indent = ' '.repeat(spaces)
    return s.split('\n').map(line => line.length > 0 ? indent + line : '').join('\n')
  }

  const defaultProvider = 'openrouter'
  const effectiveModel = model || 'nvidia/nemotron-nano-9b-v2:free'

  return `telegram:
  token: "${escapeYaml(telegramToken)}"
  allowed_users: []

llm:
  default_provider: ${defaultProvider}
  default_model: "${escapeYaml(effectiveModel)}"
  openrouter:
    api_key: "${escapeYaml(openrouterKey)}"
  max_retries: 2

agent:
  system_prompt: |
${indentForYaml(SYSTEM_PROMPT, 4)}
  max_tool_iterations: 25
  max_context_tokens: 100000
  compact_after_messages: 50

tools:
  enabled:
    - exec
    - file_read
    - file_write
    - file_edit
    - memory_save
    - memory_search
    - memory_get
    - memory_delete
    - desktop
  exec:
    workspace: /home/sandbox/workspace
    timeout: "30s"
  fs:
    workspace: /home/sandbox/workspace

# MCP servers — the desktop MCP provides all browser interaction tools.
mcp:
  servers:
    - name: desktop
      transport: stdio
      command: node
      args: ["/opt/browser-server/dist/desktop-mcp.js"]

transport:
  http:
    enabled: true
    port: 9223

memory:
  db_path: /home/sandbox/.boneclaw/memory.db
  wal_mode: true

logging:
  level: info
  format: json
`
}

// Auth derive function
async function authDerive(headers: Record<string, string | undefined>, jwtVerify: (token: string) => Promise<unknown>) {
  const authorization = headers.authorization
  
  if (!authorization?.startsWith('Bearer ')) {
    return { user: null }
  }
  
  const token = authorization.slice(7)
  const payload = await jwtVerify(token) as { userId: string } | null
  
  if (!payload) {
    return { user: null }
  }
  
  const user = getUser(payload.userId)
  return { user }
}

// Check if user owns the instance
function checkOwnership(instanceId: string, userId: string): Instance | null {
  const instance = instances.get(instanceId)
  if (!instance) return null
  if (instance.userId !== userId) return null
  return instance
}

export const instanceRoutes = new Elysia({ prefix: '/instances' })
  .use(jwt({
    name: 'jwt',
    secret: JWT_SECRET,
  }))
  .derive(async ({ headers, jwt }) => {
    return authDerive(headers, jwt.verify)
  })
  .onBeforeHandle(({ user, set }) => {
    if (!user) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
  })

  // Get user's instance (create container if needed)
  .get('/me', async ({ user, set }) => {
    // Find existing instance for user
    let instanceId: string | undefined
    for (const [id, inst] of instances) {
      if (inst.userId === user!.id) {
        instanceId = id
        break
      }
    }

    if (!instanceId) {
      // Create new container for user
      try {
        const container = await containerManager.createContainer(user!.id)
        instanceId = user!.id
        
        const instance: Instance = {
          id: instanceId,
          userId: user!.id,
          status: 'running',
          createdAt: new Date(),
        }
        instances.set(instanceId, instance)

        // Create browser and agent sessions
        await browserClient.createSession(instanceId)
        agentClient.createSession(instanceId, container.ports.agent)

        return { instance, container }
      } catch (error) {
        set.status = 500
        return { error: error instanceof Error ? error.message : 'Failed to create instance' }
      }
    }

    const container = containerManager.getContainer(instanceId)
    const instance = instances.get(instanceId)

    return { instance, container }
  })

  // Get instance by ID
  .get('/:id', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    return { instance, container }
  })

  // Reboot instance
  .post('/:id/reboot', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    try {
      // Destroy old sessions (terminal, browser, agent)
      terminalServer.destroyInstance(params.id)
      await browserClient.destroySession(params.id)
      agentClient.destroySession(params.id)

      // Reboot container
      const container = await containerManager.rebootContainer(params.id)

      // Recreate sessions
      await browserClient.createSession(params.id)
      agentClient.createSession(params.id, container.ports.agent)

      return { status: 'ok', container }
    } catch (error) {
      set.status = 500
      return { error: error instanceof Error ? error.message : 'Failed to reboot instance' }
    }
  })

  // ── Agent routes ──

  // Send a message to the agent
  .post('/:id/agent/chat', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const { message, session_key } = body as { message: string; session_key?: string }
    if (!message) {
      set.status = 400
      return { error: 'message is required' }
    }

    try {
      const response = await agentClient.sendMessage(params.id, message, session_key)
      return { response, session_key: session_key || 'http_default' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 502
      return { error: `Agent error: ${msg}` }
    }
  })

  // Get conversation history from the agent
  .get('/:id/agent/history', async ({ params, query, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const q = query as Record<string, string | undefined>
    const sessionKey = q.session_key || 'ws_default'

    try {
      const history = await agentClient.getHistory(params.id, sessionKey)
      return history
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 502
      return { error: `Agent error: ${msg}` }
    }
  })

  // Get agent status
  .get('/:id/agent/status', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    try {
      const agentStatus = await agentClient.getStatus(params.id)
      const connected = agentClient.isConnected(params.id)
      return { ...agentStatus, connected }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 502
      return { error: `Agent error: ${msg}` }
    }
  })

  // Read the current agent config values (secrets masked)
  .get('/:id/agent/config', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const containerName = containerManager.getContainerName(params.id)

    try {
      const configContent = execFileSync(
        'docker', ['exec', containerName, 'cat', '/etc/boneclaw/config.yaml'],
        { encoding: 'utf-8', timeout: 5000 }
      )

      const extract = (pattern: RegExp): string => {
        const m = configContent.match(pattern)
        return m ? m[1] : ''
      }

      // Extract the OpenRouter key specifically
      const openrouterMatch = configContent.match(/openrouter:\s*\n\s*api_key:\s*"([^"]*)"/m)
      const rawApiKey = openrouterMatch ? openrouterMatch[1] : ''
      const rawTelegramToken = extract(/token:\s*"([^"]*)"/m)
      const model = extract(/default_model:\s*"([^"]*)"/m)

      const isReal = (s: string) => s.length > 0 && !s.startsWith('${')

      const mask = (s: string) => {
        if (!isReal(s)) return ''
        if (s.length <= 4) return '****'
        return '*'.repeat(s.length - 4) + s.slice(-4)
      }

      return {
        openrouter_api_key: mask(rawApiKey),
        telegram_bot_token: mask(rawTelegramToken),
        model: isReal(model) ? model : '',
        has_api_key: isReal(rawApiKey),
        has_telegram_token: isReal(rawTelegramToken),
      }
    } catch {
      set.status = 500
      return { error: 'Failed to read config' }
    }
  })

  // Check if agent has a valid API key configured
  .get('/:id/agent/config/status', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const containerName = containerManager.getContainerName(params.id)

    try {
      const configContent = execFileSync(
        'docker', ['exec', containerName, 'cat', '/etc/boneclaw/config.yaml'],
        { encoding: 'utf-8', timeout: 5000 }
      )

      const hasRealValue = (pattern: RegExp) => {
        const m = configContent.match(pattern)
        if (!m) return false
        const val = m[1]
        return val.length > 0 && !val.startsWith('${')
      }
      const hasApiKey = hasRealValue(/openrouter:\s*\n\s*api_key:\s*"([^"]*)"/m)
      const hasTelegramToken = hasRealValue(/token:\s*"([^"]*)"/m)

      return { configured: hasApiKey, hasApiKey, hasTelegramToken }
    } catch {
      return { configured: false, hasApiKey: false, hasTelegramToken: false }
    }
  })

  // Update agent configuration (BYOK)
  .put('/:id/agent/config', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const config = body as AgentConfig
    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const containerName = containerManager.getContainerName(params.id)

    try {
      let existingApiKey = ''
      let existingTelegramToken = ''
      let existingModel = ''

      try {
        const existing = execFileSync(
          'docker', ['exec', containerName, 'cat', '/etc/boneclaw/config.yaml'],
          { encoding: 'utf-8', timeout: 5000 }
        )
        const extract = (pattern: RegExp): string => {
          const m = existing.match(pattern)
          return m ? m[1] : ''
        }
        const clean = (s: string) => s.startsWith('${') ? '' : s
        const openrouterMatch = existing.match(/openrouter:\s*\n\s*api_key:\s*"([^"]*)"/m)
        existingApiKey = clean(openrouterMatch ? openrouterMatch[1] : '')
        existingTelegramToken = clean(extract(/token:\s*"([^"]*)"/m))
        existingModel = clean(extract(/default_model:\s*"([^"]*)"/m))
      } catch {
        // Can't read existing config — start from defaults
      }

      const mergedConfig: AgentConfig = {
        openrouter_api_key: config.openrouter_api_key ?? existingApiKey,
        telegram_bot_token: config.telegram_bot_token ?? existingTelegramToken,
        model: config.model ?? existingModel,
      }

      const yamlContent = generateBoneclawConfig(mergedConfig)

      const configBuf = Buffer.from(yamlContent)
      execFileSync('docker', ['exec', '-i', containerName, 'tee', '/etc/boneclaw/config.yaml'], {
        input: configBuf,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })

      // Try restart first; if boneclaw is in FATAL state it will fail, so fall back to stop+start.
      try {
        execFileSync('docker', ['exec', containerName, 'supervisorctl', 'restart', 'boneclaw'], {
          stdio: 'pipe',
          timeout: 10000,
        })
      } catch {
        // Likely in FATAL state — stop (ignore errors) then start
        try {
          execFileSync('docker', ['exec', containerName, 'supervisorctl', 'stop', 'boneclaw'], {
            stdio: 'pipe',
            timeout: 5000,
          })
        } catch { /* may already be stopped */ }
        execFileSync('docker', ['exec', containerName, 'supervisorctl', 'start', 'boneclaw'], {
          stdio: 'pipe',
          timeout: 10000,
        })
      }

      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log(`[Agent] Config updated and boneclaw restarted for ${params.id}`)
      return { status: 'ok', message: 'Configuration applied, agent restarted' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Agent] Config update failed for ${params.id}:`, msg)
      set.status = 500
      return { error: `Config update failed: ${msg}` }
    }
  })

  // ── Desktop state snapshot ──
  .get('/:id/desktop/state', async ({ params, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    return {
      windows: getDesktopWindows(params.id),
      browser: browserStateCache.get(params.id) ?? null,
    }
  })

  // ── Filesystem ──
  .get('/:id/files', async ({ params, query, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const q = query as Record<string, string | undefined>
    const dirPath = q.path || '/home/sandbox/workspace'

    try {
      const entries = await containerManager.listDirectory(params.id, dirPath)
      return { path: dirPath, entries }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to list directory: ${msg}` }
    }
  })

  .get('/:id/files/read', async ({ params, query, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const q = query as Record<string, string | undefined>
    const filePath = q.path
    if (!filePath) {
      set.status = 400
      return { error: 'path query parameter is required' }
    }

    try {
      const content = await containerManager.readFile(params.id, filePath)
      return { path: filePath, content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to read file: ${msg}` }
    }
  })

  .put('/:id/files/write', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }

    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }

    const { path: filePath, content } = body as { path?: string; content?: string }
    if (!filePath || content === undefined) {
      set.status = 400
      return { error: 'path and content are required' }
    }

    try {
      await containerManager.writeFile(params.id, filePath, content)
      return { status: 'ok', path: filePath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to write file: ${msg}` }
    }
  })

  .post('/:id/files/create', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }
    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }
    const { path: filePath } = body as { path?: string }
    if (!filePath) {
      set.status = 400
      return { error: 'path is required' }
    }
    try {
      await containerManager.createFile(params.id, filePath)
      return { status: 'ok', path: filePath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to create file: ${msg}` }
    }
  })

  .post('/:id/files/mkdir', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }
    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }
    const { path: dirPath } = body as { path?: string }
    if (!dirPath) {
      set.status = 400
      return { error: 'path is required' }
    }
    try {
      await containerManager.createDirectory(params.id, dirPath)
      return { status: 'ok', path: dirPath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to create directory: ${msg}` }
    }
  })

  .post('/:id/files/delete', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }
    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }
    const { path: itemPath } = body as { path?: string }
    if (!itemPath) {
      set.status = 400
      return { error: 'path is required' }
    }
    try {
      await containerManager.deleteItem(params.id, itemPath)
      return { status: 'ok', path: itemPath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to delete: ${msg}` }
    }
  })

  .post('/:id/files/rename', async ({ params, body, user, set }) => {
    const instance = checkOwnership(params.id, user!.id)
    if (!instance) {
      set.status = 404
      return { error: 'Instance not found' }
    }
    const container = containerManager.getContainer(params.id)
    if (!container) {
      set.status = 404
      return { error: 'Container not found' }
    }
    const { oldPath, newPath } = body as { oldPath?: string; newPath?: string }
    if (!oldPath || !newPath) {
      set.status = 400
      return { error: 'oldPath and newPath are required' }
    }
    try {
      await containerManager.renameItem(params.id, oldPath, newPath)
      return { status: 'ok', oldPath, newPath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { error: `Failed to rename: ${msg}` }
    }
  })
