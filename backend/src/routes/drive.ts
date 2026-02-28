import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { getUser } from '../services/auth.service'
import { DriveService } from '../services/drive-service'
import { DriveSync } from '../services/drive-sync'
import { containerManager, checkOwnership } from '../services'
import { config } from '../config'

const JWT_SECRET = process.env.JWT_SECRET || 'construct-computer-jwt-secret-change-in-production'

// Auth derive (same pattern as instances.ts)
async function authDerive(headers: Record<string, string | undefined>, jwtVerify: (token: string) => Promise<unknown>) {
  const authorization = headers.authorization
  if (!authorization?.startsWith('Bearer ')) return { user: null }
  const token = authorization.slice(7)
  const payload = await jwtVerify(token) as { userId: string } | null
  if (!payload) return { user: null }
  const user = getUser(payload.userId)
  return { user }
}

export function createDriveRoutes(driveService: DriveService, driveSync: DriveSync) {
  return new Elysia({ prefix: '/drive' })
    // --- Public routes (no auth) ---

    // Check if Drive integration is configured
    .get('/configured', () => {
      return { configured: driveService.isConfigured }
    })

    // OAuth callback (redirect from Google — no auth token)
    .get('/callback', async ({ query }) => {
      const q = query as Record<string, string | undefined>
      const { code, state, error: oauthError } = q

      const frontendOrigin = config.frontendUrl

      if (oauthError) {
        return Response.redirect(`${frontendOrigin}/?drive=denied`)
      }

      if (!code || !state) {
        return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 })
      }

      const userId = driveService.validateOAuthState(state)
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Invalid or expired OAuth state token' }), { status: 400 })
      }

      try {
        const result = await driveService.handleCallback(userId, code)
        return Response.redirect(`${frontendOrigin}/?drive=connected&email=${encodeURIComponent(result.email || '')}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[Drive] OAuth callback error:', message)
        return Response.redirect(`${frontendOrigin}/?drive=error`)
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

    // Get OAuth authorization URL
    .get('/auth-url', ({ user }) => {
      if (!driveService.isConfigured) {
        return { error: 'Google Drive integration is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' }
      }
      const url = driveService.getAuthUrl(user!.id)
      return { url }
    })

    // Get Drive connection status
    .get('/status', async ({ user }) => {
      return driveService.getStatus(user!.id)
    })

    // Disconnect Google Drive
    .delete('/disconnect', async ({ user }) => {
      await driveService.disconnect(user!.id)
      return { status: 'ok' }
    })

    // List files in a Drive folder
    .get('/files', async ({ user, query, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      try {
        const q = query as Record<string, string | undefined>
        const folderId = q.folderId || await driveService.ensureWorkspaceFolder(user!.id)
        const files = await driveService.listFolder(user!.id, folderId)
        return { files, folderId }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Read a file from Drive (returns text content)
    .get('/files/:fileId/content', async ({ user, params, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      try {
        const content = await driveService.downloadFile(user!.id, params.fileId)
        return { content: content.toString('utf-8') }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Download a file from Drive (binary)
    .get('/files/:fileId/download', async ({ user, params, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      try {
        const meta = await driveService.getFileMeta(user!.id, params.fileId)
        const content = await driveService.downloadFile(user!.id, params.fileId)
        const asciiName = (meta.name || 'file').replace(/[^\x20-\x7E]/g, '_')
        const encodedName = encodeURIComponent(meta.name || 'file')
        const buf = Buffer.from(content)
        return new Response(buf, {
          headers: {
            'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
            'Content-Type': meta.mimeType || 'application/octet-stream',
            'Content-Length': String(buf.length),
          },
        })
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Upload a file to Drive
    .post('/upload', async ({ user, query, request, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      const q = query as Record<string, string | undefined>
      const { name, folderId } = q
      if (!name) {
        set.status = 400
        return { error: 'Missing name query parameter' }
      }
      try {
        const parentId = folderId || await driveService.ensureWorkspaceFolder(user!.id)
        const arrayBuf = await request.arrayBuffer()
        const body = Buffer.from(arrayBuf)
        if (!body || body.length === 0) {
          set.status = 400
          return { error: 'Empty file' }
        }
        const fileId = await driveService.uploadFile(user!.id, parentId, name, body)
        return { status: 'ok', fileId }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Create a folder on Drive
    .post('/mkdir', async ({ user, body, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      const { name, parentFolderId } = body as { name: string; parentFolderId?: string }
      if (!name) {
        set.status = 400
        return { error: 'Missing folder name' }
      }
      try {
        const parentId = parentFolderId || await driveService.ensureWorkspaceFolder(user!.id)
        const folderId = await driveService.createFolder(user!.id, parentId, name)
        return { status: 'ok', folderId }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Delete a file or folder on Drive (trash)
    .delete('/files/:fileId', async ({ user, params, set }) => {
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      try {
        await driveService.trashFile(user!.id, params.fileId)
        return { status: 'ok' }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Copy file from container to Drive
    .post('/copy-to-drive/:instanceId', async ({ user, params, body, set }) => {
      const { instanceId } = params
      if (!checkOwnership(instanceId, user!.id)) {
        set.status = 404
        return { error: 'Instance not found' }
      }
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      const { filePath, driveFolderId } = body as { filePath: string; driveFolderId?: string }
      try {
        const content = await containerManager.readFileBinary(instanceId, filePath)
        const fileName = filePath.split('/').pop() || 'file'
        const parentId = driveFolderId || await driveService.ensureWorkspaceFolder(user!.id)
        const fileId = await driveService.uploadFile(user!.id, parentId, fileName, content)
        return { status: 'ok', fileId }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Copy file from Drive to container
    .post('/copy-to-local/:instanceId', async ({ user, params, body, set }) => {
      const { instanceId } = params
      if (!checkOwnership(instanceId, user!.id)) {
        set.status = 404
        return { error: 'Instance not found' }
      }
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      const { driveFileId, containerPath } = body as { driveFileId: string; containerPath: string }
      try {
        const content = await driveService.downloadFile(user!.id, driveFileId)
        await containerManager.writeFileBinary(instanceId, containerPath, content)
        return { status: 'ok' }
      } catch (err) {
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })

    // Sync
    .post('/sync/:instanceId', async ({ user, params, set }) => {
      const { instanceId } = params
      if (!checkOwnership(instanceId, user!.id)) {
        set.status = 404
        return { error: 'Instance not found' }
      }
      const driveStatus = await driveService.getStatus(user!.id)
      if (!driveStatus.connected) {
        set.status = 400
        return { error: 'Google Drive is not connected' }
      }
      try {
        const report = await driveSync.sync(user!.id, instanceId)
        return report
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        set.status = 500
        return { error: `Sync failed: ${message}` }
      }
    })
}
