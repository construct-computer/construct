import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { getUser } from '../services/auth.service'
import { config } from '../config'
import { saveSlackInstallation, getSlackInstallationByTeam, getSlackInstallationByUser, deleteSlackInstallationByUser } from '../db/client'
import type { SlackManager } from '../services/slack-manager'

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production'

// OAuth state tokens — map state → userId (short-lived, in memory)
const oauthStates = new Map<string, { userId: string; expires: number }>()

// Clean expired states periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of oauthStates) {
    if (val.expires < now) oauthStates.delete(key)
  }
}, 60_000)

// Auth derive (same as drive.ts)
async function authDerive(headers: Record<string, string | undefined>, jwtVerify: (token: string) => Promise<unknown>) {
  const authorization = headers.authorization
  if (!authorization?.startsWith('Bearer ')) return { user: null }
  const token = authorization.slice(7)
  const payload = await jwtVerify(token) as { userId: string } | null
  if (!payload) return { user: null }
  const user = getUser(payload.userId)
  return { user }
}

export function createSlackRoutes(slackManager: SlackManager) {
  const botScopes = [
    'app_mentions:read',
    'chat:write',
    'files:write',
    'im:history',
    'im:read',
    'im:write',
    'channels:history',
    'reactions:write',
    'users:read',
  ]

  return new Elysia({ prefix: '/slack' })
    // --- Public routes (no auth) ---

    // Check if Slack integration is configured on the server
    .get('/configured', () => {
      return { configured: slackManager.isConfigured }
    })

    // OAuth callback — redirected here from Slack after user authorizes
    .get('/callback', async ({ query }) => {
      const q = query as Record<string, string | undefined>
      const { code, state, error: oauthError } = q
      const frontendOrigin = config.frontendUrl

      if (oauthError) {
        return Response.redirect(`${frontendOrigin}/?slack=denied&slack_error=${encodeURIComponent(oauthError)}`)
      }

      if (!code || !state) {
        return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 })
      }

      // Validate state token
      const stateData = oauthStates.get(state)
      if (!stateData || stateData.expires < Date.now()) {
        oauthStates.delete(state)
        return new Response(JSON.stringify({ error: 'Invalid or expired OAuth state' }), { status: 400 })
      }
      oauthStates.delete(state)
      const userId = stateData.userId

      // Exchange code for access token using Slack's oauth.v2.access
      try {
        const exchangeParams: Record<string, string> = {
          client_id: config.slackClientId,
          client_secret: config.slackClientSecret,
          code,
        }
        // Must include the same redirect_uri used in the authorize step
        if (config.slackRedirectUri) {
          exchangeParams.redirect_uri = config.slackRedirectUri
        }

        const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(exchangeParams),
        })

        const data = await tokenRes.json() as {
          ok: boolean
          error?: string
          team?: { id: string; name: string }
          access_token?: string
          bot_user_id?: string
        }

        if (!data.ok || !data.access_token || !data.team) {
          const slackError = data.error || 'unknown'
          console.error('[Slack] OAuth token exchange failed:', slackError)
          return Response.redirect(`${frontendOrigin}/?slack=error&slack_error=${encodeURIComponent(slackError)}`)
        }

        const teamId = data.team.id
        const teamName = data.team.name
        const botToken = data.access_token
        const botUserId = data.bot_user_id || ''

        // Check if this workspace is already linked to a different user
        const existing = getSlackInstallationByTeam(teamId)
        if (existing && existing.userId !== userId) {
          console.warn(`[Slack] Workspace ${teamName} (${teamId}) already linked to user ${existing.userId}, rejecting install from ${userId}`)
          return Response.redirect(`${frontendOrigin}/?slack=error&slack_error=${encodeURIComponent('workspace_already_linked')}`)
        }

        // Save installation (new or same-user refresh)
        saveSlackInstallation({
          teamId,
          teamName,
          userId,
          botToken,
          botUserId,
        })

        // Register with the SlackManager
        slackManager.registerInstallation(teamId, botToken)

        console.log(`[Slack] Installed for team ${teamName} (${teamId}) → user ${userId}`)
        return Response.redirect(`${frontendOrigin}/?slack=connected&team=${encodeURIComponent(teamName)}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[Slack] OAuth callback error:', message)
        return Response.redirect(`${frontendOrigin}/?slack=error&slack_error=${encodeURIComponent(message)}`)
      }
    })

    // --- Authenticated routes ---
    .use(jwt({ name: 'jwt', secret: JWT_SECRET }))
    .derive(async ({ headers, jwt }) => {
      return authDerive(headers, jwt.verify)
    })
    .onBeforeHandle(({ user, set }) => {
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }
    })

    // Get the OAuth install URL — starts the "Add to Slack" flow
    .get('/install', ({ user }) => {
      if (!slackManager.isConfigured) {
        return { error: 'Slack integration is not configured on this server.' }
      }

      // Generate state token
      const state = crypto.randomUUID()
      oauthStates.set(state, { userId: user!.id, expires: Date.now() + 10 * 60 * 1000 }) // 10 min

      const redirectUri = config.slackRedirectUri
      if (!redirectUri) {
        return { error: 'SLACK_REDIRECT_URI is not configured.' }
      }

      const url = `https://slack.com/oauth/v2/authorize?` + new URLSearchParams({
        client_id: config.slackClientId,
        scope: botScopes.join(','),
        redirect_uri: redirectUri,
        state,
      }).toString()

      return { url }
    })

    // Get Slack connection status for the current user
    .get('/status', ({ user }) => {
      if (!slackManager.isConfigured) {
        return { configured: false, connected: false }
      }

      const installation = getSlackInstallationByUser(user!.id)
      if (!installation) {
        return { configured: true, connected: false }
      }

      return {
        configured: true,
        connected: true,
        teamName: installation.teamName,
        teamId: installation.teamId,
        installedAt: installation.installedAt,
      }
    })

    // Disconnect Slack (remove installation)
    .delete('/disconnect', ({ user }) => {
      const installation = getSlackInstallationByUser(user!.id)
      if (installation) {
        slackManager.unregisterInstallation(installation.teamId)
      } else {
        deleteSlackInstallationByUser(user!.id)
      }
      return { status: 'ok' }
    })
}
