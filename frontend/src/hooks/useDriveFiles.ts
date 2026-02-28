import { useState, useCallback, useEffect, useRef } from 'react'
import {
  listDriveFiles,
  readDriveFileContent,
  deleteDriveFile,
  type DriveFileEntry,
} from '@/services/api'

const POLL_INTERVAL = 15_000

// Module-level cache — survives hook unmount/remount and tab switches.
// Key is folderId or '__root__' for the workspace root.
const fileCache = new Map<string, DriveFileEntry[]>()
const rootFolderIdCache: { value: string | null } = { value: null }

function cacheKey(folderId?: string): string {
  return folderId || '__root__'
}

/**
 * Hook for browsing Google Drive's ConstructWorkspace folder.
 * Mirrors the local file browser API pattern.
 *
 * Uses a persistent in-memory cache so switching to the cloud tab
 * shows files instantly. A silent background refresh keeps them current.
 * When `active` is true, the current folder is also polled every 15s.
 */
export function useDriveFiles(active = false) {
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([])
  const [files, setFiles] = useState<DriveFileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<DriveFileEntry | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null
  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId
  const folderStackLenRef = useRef(folderStack.length)
  folderStackLenRef.current = folderStack.length

  const currentPath = '/' + folderStack.map(f => f.name).join('/')

  /**
   * Fetch files for a folder. Three modes:
   * - Default: show loading spinner, populate cache.
   * - silent=true: no spinners at all (background poll).
   * - bg=true: show the small status-bar spinner (isSilentRefreshing).
   */
  const fetchFiles = useCallback(async (folderId?: string, silent = false, bg = false) => {
    if (!silent && !bg) setIsLoading(true)
    if (bg) setIsSilentRefreshing(true)
    setError(null)
    try {
      const result = await listDriveFiles(folderId)
      if (result.success) {
        const fetched = result.data.files || []
        setFiles(fetched)
        fileCache.set(cacheKey(folderId), fetched)
        if (result.data.folderId) {
          rootFolderIdCache.value = result.data.folderId
        }
        if (folderStackLenRef.current === 0 && result.data.folderId) {
          setFolderStack([{ id: result.data.folderId, name: 'Cloud' }])
        }
      } else if (!silent && !bg) {
        setError(result.error || 'Failed to list files')
      }
    } catch {
      if (!silent && !bg) setError('Network error')
    } finally {
      if (!silent && !bg) setIsLoading(false)
      if (bg) setIsSilentRefreshing(false)
    }
  }, [])

  // Auto-poll when active
  useEffect(() => {
    if (!active) return
    const interval = setInterval(() => {
      fetchFiles(currentFolderIdRef.current || undefined, true)
    }, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [active, fetchFiles])

  /**
   * Open a folder: show cached files instantly, then background-refresh.
   */
  const openFolder = useCallback(async (folderId?: string) => {
    const cached = fileCache.get(cacheKey(folderId))
    if (cached) {
      // Show cache immediately, then refresh silently in background
      setFiles(cached)
      setIsLoading(false)
      fetchFiles(folderId, false, true) // bg spinner
    } else {
      // No cache — full loading spinner
      await fetchFiles(folderId)
    }
  }, [fetchFiles])

  const navigateInto = useCallback(async (file: DriveFileEntry) => {
    if (file.type === 'directory') {
      setFolderStack(prev => [...prev, { id: file.id, name: file.name }])
      setSelectedFile(null)
      setFileContent('')
      await openFolder(file.id)
    } else {
      setSelectedFile(file)
      setFileContent('')
      // Auto-load text content for small files
      if (file.size < 512_000) {
        const result = await readDriveFileContent(file.id)
        if (result.success) {
          setFileContent(result.data.content || '')
        }
      }
    }
  }, [openFolder])

  const goUp = useCallback(async () => {
    if (folderStack.length <= 1) return
    const newStack = folderStack.slice(0, -1)
    setFolderStack(newStack)
    setSelectedFile(null)
    setFileContent('')
    await openFolder(newStack[newStack.length - 1].id)
  }, [folderStack, openFolder])

  const refresh = useCallback(async () => {
    await fetchFiles(currentFolderIdRef.current || undefined)
  }, [fetchFiles])

  const resetToRoot = useCallback(async () => {
    setFolderStack([])
    setSelectedFile(null)
    setFileContent('')
    await openFolder(undefined)
  }, [openFolder])

  const deleteFile = useCallback(async (fileId: string) => {
    const result = await deleteDriveFile(fileId)
    if (result.success) {
      setFiles(prev => {
        const updated = prev.filter(f => f.id !== fileId)
        // Update cache too
        fileCache.set(cacheKey(currentFolderIdRef.current || undefined), updated)
        return updated
      })
      if (selectedFile?.id === fileId) {
        setSelectedFile(null)
        setFileContent('')
      }
    } else {
      setError(result.error || 'Delete failed')
    }
  }, [selectedFile])

  const formatSize = useCallback((size?: number) => {
    if (!size) return '0 B'
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return {
    currentPath,
    currentFolderId,
    folderStack,
    files,
    selectedFile,
    fileContent,
    isLoading,
    isSilentRefreshing,
    error,
    navigateInto,
    goUp,
    resetToRoot,
    refresh,
    deleteFile,
    formatSize,
    clearError,
    clearSelection: () => { setSelectedFile(null); setFileContent('') },
  }
}
