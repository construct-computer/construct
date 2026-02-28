import { DriveService, type DriveFile } from './drive-service'
import { ContainerManager } from '../container-manager'
import { updateDriveLastSync } from '../db/client'

export interface DriveSyncReport {
  downloaded: string[]
  uploaded: string[]
  deleted: string[]
  conflicts: string[]
  timestamp: string
}

interface ContainerFile {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedTime: number // epoch ms
}

/**
 * DriveSync handles two-way synchronization between a user's Google Drive
 * "ConstructWorkspace" folder and the container's /home/sandbox/workspace.
 *
 * Sync strategy:
 * - Compare files by relative path and modified time
 * - Newer file wins (Drive or container)
 * - Files only on one side get synced to the other
 * - Container wins on conflict (same mtime or unparsable)
 */
export class DriveSync {
  constructor(
    private driveService: DriveService,
    private containerManager: ContainerManager,
  ) {}

  /**
   * Run a full two-way sync between Drive and container workspace.
   */
  async sync(userId: string, instanceId: string): Promise<DriveSyncReport> {
    const report: DriveSyncReport = {
      downloaded: [],
      uploaded: [],
      deleted: [],
      conflicts: [],
      timestamp: new Date().toISOString(),
    }

    console.log(`[DriveSync] Starting sync for user ${userId}, instance ${instanceId}`)

    // 1. Ensure workspace folder exists on Drive
    const folderId = await this.driveService.ensureWorkspaceFolder(userId)

    // 2. List files on both sides
    const driveFiles = await this.driveService.listFiles(userId)
    const containerFiles = await this.listContainerFiles(instanceId)

    // Build lookup maps by relative path
    const driveMap = new Map<string, DriveFile>()
    for (const f of driveFiles) {
      driveMap.set(f.path, f)
    }

    const containerMap = new Map<string, ContainerFile>()
    for (const f of containerFiles) {
      containerMap.set(f.path, f)
    }

    // 3. Sync: Drive -> Container
    for (const [path, driveFile] of driveMap) {
      if (driveFile.isFolder) {
        if (!containerMap.has(path)) {
          try {
            await this.containerManager.createDirectory(instanceId, '/home/sandbox/workspace/' + path)
          } catch { /* may already exist */ }
        }
        continue
      }

      const containerFile = containerMap.get(path)
      if (!containerFile) {
        // File only on Drive -- download to container
        try {
          const content = await this.driveService.downloadFile(userId, driveFile.id)
          const parentDir = path.includes('/')
            ? '/home/sandbox/workspace/' + path.substring(0, path.lastIndexOf('/'))
            : '/home/sandbox/workspace'
          try { await this.containerManager.createDirectory(instanceId, parentDir) } catch { /* ok */ }
          await this.containerManager.writeFileBinary(instanceId, '/home/sandbox/workspace/' + path, content)
          report.downloaded.push(path)
          console.log(`[DriveSync] Downloaded: ${path}`)
        } catch (err) {
          console.error(`[DriveSync] Failed to download ${path}:`, err)
        }
      } else {
        // File exists on both sides -- compare modified times
        const driveTime = new Date(driveFile.modifiedTime).getTime()
        const containerTime = containerFile.modifiedTime
        if (driveTime > containerTime + 1000) {
          try {
            const content = await this.driveService.downloadFile(userId, driveFile.id)
            await this.containerManager.writeFileBinary(instanceId, '/home/sandbox/workspace/' + path, content)
            report.downloaded.push(path)
            console.log(`[DriveSync] Updated from Drive: ${path}`)
          } catch (err) {
            console.error(`[DriveSync] Failed to update ${path} from Drive:`, err)
            report.conflicts.push(path)
          }
        }
      }
    }

    // 4. Sync: Container -> Drive
    const driveFolderIds = new Map<string, string>()
    driveFolderIds.set('', folderId)
    for (const f of driveFiles) {
      if (f.isFolder) {
        driveFolderIds.set(f.path, f.id)
      }
    }

    for (const [path, containerFile] of containerMap) {
      if (containerFile.isDirectory) {
        if (!driveMap.has(path)) {
          try {
            const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
            const parentId = driveFolderIds.get(parentPath) || folderId
            const newFolderId = await this.driveService.createFolder(userId, parentId, containerFile.name)
            driveFolderIds.set(path, newFolderId)
          } catch (err) {
            console.error(`[DriveSync] Failed to create folder ${path} on Drive:`, err)
          }
        }
        continue
      }

      const driveFile = driveMap.get(path)
      if (!driveFile) {
        // File only in container -- upload to Drive
        try {
          const content = await this.containerManager.readFileBinary(instanceId, '/home/sandbox/workspace/' + path)
          const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
          const parentId = driveFolderIds.get(parentPath) || folderId
          await this.driveService.uploadFile(userId, parentId, containerFile.name, content)
          report.uploaded.push(path)
          console.log(`[DriveSync] Uploaded: ${path}`)
        } catch (err) {
          console.error(`[DriveSync] Failed to upload ${path}:`, err)
        }
      } else {
        // File exists on both sides -- check if container is newer
        const driveTime = new Date(driveFile.modifiedTime).getTime()
        const containerTime = containerFile.modifiedTime
        if (containerTime > driveTime + 1000) {
          try {
            const content = await this.containerManager.readFileBinary(instanceId, '/home/sandbox/workspace/' + path)
            await this.driveService.uploadFile(
              userId, '', containerFile.name, content,
              'application/octet-stream', driveFile.id,
            )
            report.uploaded.push(path)
            console.log(`[DriveSync] Updated on Drive: ${path}`)
          } catch (err) {
            console.error(`[DriveSync] Failed to update ${path} on Drive:`, err)
            report.conflicts.push(path)
          }
        }
      }
    }

    // 5. Update last sync timestamp
    updateDriveLastSync(userId, report.timestamp)

    console.log(`[DriveSync] Sync complete: ${report.downloaded.length} downloaded, ${report.uploaded.length} uploaded, ${report.conflicts.length} conflicts`)
    return report
  }

  /**
   * List all files in the container workspace with metadata.
   */
  private async listContainerFiles(instanceId: string, dirPath = '/home/sandbox/workspace', basePath = ''): Promise<ContainerFile[]> {
    const files: ContainerFile[] = []
    const entries = await this.containerManager.listDirectory(instanceId, dirPath)

    for (const entry of entries) {
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

      files.push({
        name: entry.name,
        path: relativePath,
        isDirectory: entry.type === 'directory',
        size: entry.size ?? 0,
        modifiedTime: entry.modified ? new Date(entry.modified).getTime() : Date.now(),
      })

      if (entry.type === 'directory') {
        const subPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`
        const subFiles = await this.listContainerFiles(instanceId, subPath, relativePath)
        files.push(...subFiles)
      }
    }

    return files
  }
}
