import { google, type drive_v3 } from 'googleapis'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import { Readable } from 'stream'
import {
  getDb,
  getDriveTokens,
  saveDriveTokens,
  updateDriveAccessToken,
  updateDriveFolderId,
  deleteDriveTokens,
} from '../db/client'
import { encrypt, decrypt } from './crypto.service'
import { config } from '../config'

const SCOPES = ['https://www.googleapis.com/auth/drive']
const WORKSPACE_FOLDER_NAME = 'ConstructWorkspace'

/**
 * DriveService wraps the Google Drive API.
 * Manages OAuth2 per-user, handles token refresh, and provides file operations
 * scoped to the "ConstructWorkspace" folder on the user's Drive.
 */
export class DriveService {
  /** Pending OAuth state tokens mapped to user IDs. Expires after 10 minutes. */
  private pendingOAuthStates = new Map<string, { userId: string; expiresAt: number }>()

  /** Whether Google Drive integration is configured (credentials provided). */
  get isConfigured(): boolean {
    return !!(config.googleClientId && config.googleClientSecret)
  }

  private get redirectUri(): string {
    return config.googleRedirectUri || `http://localhost:${config.port}/api/drive/callback`
  }

  /** Generate the OAuth2 consent URL with a CSRF-safe state token. */
  getAuthUrl(userId: string): string {
    const client = this.createOAuth2Client()
    const stateToken = crypto.randomUUID() + crypto.randomUUID()
    this.pendingOAuthStates.set(stateToken, {
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    })
    // Cleanup expired states
    for (const [key, val] of this.pendingOAuthStates) {
      if (val.expiresAt < Date.now()) this.pendingOAuthStates.delete(key)
    }
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: stateToken,
    })
  }

  /**
   * Validate the OAuth state token and return the associated user ID.
   * Returns null if the state is invalid or expired.
   */
  validateOAuthState(stateToken: string): string | null {
    const entry = this.pendingOAuthStates.get(stateToken)
    if (!entry) return null
    this.pendingOAuthStates.delete(stateToken)
    if (entry.expiresAt < Date.now()) return null
    return entry.userId
  }

  /** Exchange an authorization code for tokens and save them (encrypted). */
  async handleCallback(userId: string, code: string): Promise<{ email?: string }> {
    const client = this.createOAuth2Client()
    const { tokens } = await client.getToken(code)

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try revoking access at https://myaccount.google.com/permissions and reconnecting.')
    }

    // Get user email via Drive about endpoint (works with drive scope, no extra scopes needed)
    client.setCredentials(tokens)
    let email: string | undefined
    try {
      const drive = google.drive({ version: 'v3', auth: client })
      const about = await drive.about.get({ fields: 'user' })
      email = about.data.user?.emailAddress ?? undefined
    } catch {
      // Non-fatal — email is just for display
    }

    saveDriveTokens(userId, {
      accessToken: await encrypt(tokens.access_token!),
      refreshToken: await encrypt(tokens.refresh_token),
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : new Date().toISOString(),
      email,
    })

    return { email }
  }

  /** Get an authenticated Drive client for a user. Handles token refresh. */
  async getDriveClient(userId: string): Promise<drive_v3.Drive> {
    const dbTokens = getDriveTokens(userId)
    if (!dbTokens) throw new Error('Google Drive not connected')

    const accessToken = await decrypt(dbTokens.accessToken)
    const refreshToken = await decrypt(dbTokens.refreshToken)

    const client = this.createOAuth2Client()
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: new Date(dbTokens.expiry).getTime(),
    })

    // Persist refreshed tokens (encrypted)
    client.on('tokens', async (tokens: Credentials) => {
      if (tokens.access_token) {
        const expiry = tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString()
        updateDriveAccessToken(userId, await encrypt(tokens.access_token), expiry)
      }
    })

    return google.drive({ version: 'v3', auth: client })
  }

  /**
   * Find or create the "ConstructWorkspace" folder on Drive.
   * Caches the folder ID in the database.
   */
  async ensureWorkspaceFolder(userId: string): Promise<string> {
    const dbTokens = getDriveTokens(userId)
    if (dbTokens?.folderId) {
      // Verify the cached folder still exists
      try {
        const drive = await this.getDriveClient(userId)
        const res = await drive.files.get({ fileId: dbTokens.folderId, fields: 'id,trashed' })
        if (res.data.id && !res.data.trashed) {
          return dbTokens.folderId
        }
      } catch {
        // Folder was deleted or inaccessible — recreate
      }
    }

    const drive = await this.getDriveClient(userId)

    // Search for existing folder
    const searchRes = await drive.files.list({
      q: `name='${WORKSPACE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
    })

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      const folderId = searchRes.data.files[0].id!
      updateDriveFolderId(userId, folderId)
      return folderId
    }

    // Create the folder
    const createRes = await drive.files.create({
      requestBody: {
        name: WORKSPACE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    })

    const folderId = createRes.data.id!
    updateDriveFolderId(userId, folderId)
    console.log(`[DriveService] Created workspace folder ${folderId} for user ${userId}`)
    return folderId
  }

  /**
   * List all files recursively in the workspace folder.
   * Returns flat list with relative paths.
   */
  async listFiles(userId: string, folderId?: string, basePath = ''): Promise<DriveFile[]> {
    const drive = await this.getDriveClient(userId)
    const rootFolderId = folderId || await this.ensureWorkspaceFolder(userId)
    const files: DriveFile[] = []

    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${rootFolderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)',
        pageSize: 1000,
        pageToken,
      })

      for (const file of res.data.files || []) {
        const relativePath = basePath ? `${basePath}/${file.name}` : file.name!
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder'

        files.push({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          size: file.size ? parseInt(file.size, 10) : undefined,
          modifiedTime: file.modifiedTime!,
          md5Checksum: file.md5Checksum ?? undefined,
          path: relativePath,
          isFolder,
        })

        if (isFolder) {
          const subFiles = await this.listFiles(userId, file.id!, relativePath)
          files.push(...subFiles)
        }
      }

      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    return files
  }

  /**
   * List files in a single folder (non-recursive).
   * Returns DriveFileEntry objects for the Finder UI.
   */
  async listFolder(userId: string, folderId: string): Promise<DriveFileEntry[]> {
    const drive = await this.getDriveClient(userId)
    const entries: DriveFileEntry[] = []

    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
        pageSize: 1000,
        orderBy: 'folder,name',
        pageToken,
      })

      for (const file of res.data.files || []) {
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
        entries.push({
          id: file.id!,
          name: file.name!,
          type: isFolder ? 'directory' : 'file',
          size: file.size ? parseInt(file.size, 10) : 0,
          modified: file.modifiedTime || undefined,
          mimeType: file.mimeType!,
        })
      }

      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    return entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
  }

  /** Get metadata for a single file. */
  async getFileMeta(userId: string, fileId: string): Promise<{ name: string; mimeType: string; size: number }> {
    const drive = await this.getDriveClient(userId)
    const res = await drive.files.get({ fileId, fields: 'name,mimeType,size' })
    return {
      name: res.data.name || 'file',
      mimeType: res.data.mimeType || 'application/octet-stream',
      size: res.data.size ? parseInt(res.data.size, 10) : 0,
    }
  }

  /** Download a file's content as a Buffer. */
  async downloadFile(userId: string, fileId: string): Promise<Buffer> {
    const drive = await this.getDriveClient(userId)
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )
    return Buffer.from(res.data as ArrayBuffer)
  }

  /** Upload a file to Drive. Creates or updates. */
  async uploadFile(
    userId: string,
    parentFolderId: string,
    name: string,
    content: Buffer,
    mimeType = 'application/octet-stream',
    existingFileId?: string,
  ): Promise<string> {
    const drive = await this.getDriveClient(userId)

    if (existingFileId) {
      const res = await drive.files.update({
        fileId: existingFileId,
        media: { mimeType, body: bufferToStream(content) },
        fields: 'id',
      })
      return res.data.id!
    }

    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [parentFolderId],
      },
      media: { mimeType, body: bufferToStream(content) },
      fields: 'id',
    })
    return res.data.id!
  }

  /** Create a folder on Drive. */
  async createFolder(userId: string, parentFolderId: string, name: string): Promise<string> {
    const drive = await this.getDriveClient(userId)
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
    })
    return res.data.id!
  }

  /** Delete a file on Drive (trash it). */
  async trashFile(userId: string, fileId: string): Promise<void> {
    const drive = await this.getDriveClient(userId)
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
    })
  }

  /** Disconnect Google Drive for a user. */
  async disconnect(userId: string): Promise<void> {
    const dbTokens = getDriveTokens(userId)
    if (dbTokens) {
      try {
        const accessToken = await decrypt(dbTokens.accessToken)
        const client = this.createOAuth2Client()
        await client.revokeToken(accessToken)
      } catch {
        // Revocation failure is non-fatal
      }
    }
    deleteDriveTokens(userId)
  }

  /** Check if a user has Drive connected. Backfills email if missing. */
  async getStatus(userId: string): Promise<{ connected: boolean; email?: string; lastSync?: string }> {
    const dbTokens = getDriveTokens(userId)
    if (!dbTokens) return { connected: false }

    let email = dbTokens.email ?? undefined

    // Backfill email if it was never saved (e.g. connected before the fix)
    if (!email) {
      try {
        const drive = await this.getDriveClient(userId)
        const about = await drive.about.get({ fields: 'user' })
        email = about.data.user?.emailAddress ?? undefined
        if (email) {
          getDb().prepare('UPDATE drive_tokens SET email = ? WHERE user_id = ?').run(email, userId)
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      connected: true,
      email,
      lastSync: dbTokens.lastSync ?? undefined,
    }
  }

  private createOAuth2Client(): OAuth2Client {
    return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, this.redirectUri)
  }
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime: string
  md5Checksum?: string
  path: string
  isFolder: boolean
}

export interface DriveFileEntry {
  id: string
  name: string
  type: 'file' | 'directory'
  size: number
  modified?: string
  mimeType: string
}

/** Convert a Buffer to a readable stream for googleapis media upload. */
function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return stream
}
