import { useState, useEffect, useCallback } from 'react'
import {
  getDriveConfigured,
  getDriveAuthUrl,
  getDriveStatus,
  disconnectDrive,
  syncDrive,
  type DriveStatus,
  type DriveSyncReport,
} from '@/services/api'

export function useDriveSync(instanceId: string | null) {
  const [status, setStatus] = useState<DriveStatus>({ connected: false })
  const [isConfigured, setIsConfigured] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastReport, setLastReport] = useState<DriveSyncReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check if Drive integration is configured on the server
  useEffect(() => {
    let cancelled = false
    getDriveConfigured()
      .then(result => {
        if (!cancelled && result.success) {
          setIsConfigured(result.data.configured)
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Fetch Drive connection status
  const refreshStatus = useCallback(async () => {
    const result = await getDriveStatus()
    if (result.success) {
      setStatus(result.data)
      return result.data
    }
    return null
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    refreshStatus()
  }, [isConfigured, refreshStatus])

  // Start OAuth flow
  const connect = useCallback(async () => {
    setError(null)
    const result = await getDriveAuthUrl()
    if (result.success && result.data.url) {
      window.location.href = result.data.url
    } else if (result.success && result.data.error) {
      setError(result.data.error)
    } else if (!result.success) {
      setError(result.error)
    }
  }, [])

  // Disconnect Drive
  const disconnect = useCallback(async () => {
    setError(null)
    const result = await disconnectDrive()
    if (result.success) {
      setStatus({ connected: false })
      setLastReport(null)
    } else {
      setError('Failed to disconnect')
    }
  }, [])

  // Sync files
  const sync = useCallback(async () => {
    if (!instanceId || !status.connected) return
    setIsSyncing(true)
    setError(null)
    try {
      const result = await syncDrive(instanceId)
      if (result.success) {
        setLastReport(result.data)
        await refreshStatus()
      } else {
        setError(result.error || 'Sync failed')
      }
    } catch {
      setError('Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }, [instanceId, status.connected, refreshStatus])

  const clearError = useCallback(() => setError(null), [])

  return {
    status,
    isConfigured,
    isLoading,
    isSyncing,
    lastReport,
    error,
    connect,
    disconnect,
    sync,
    clearError,
    refreshStatus,
  }
}
