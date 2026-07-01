'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  listBackups, deleteBackup as apiDeleteBackup,
  triggerBackup as apiTriggerBackup, getBackupDownloadUrl,
  type BackupObject,
} from './api'

export function useBackups(name: string) {
  const [backups, setBackups] = useState<BackupObject[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const fetchBackups = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDeleteError(null)
    try {
      const result = await listBackups(name)
      setBackups(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => {
    void fetchBackups()
  }, [fetchBackups])

  async function deleteBackup(key: string) {
    setDeleteError(null)
    setBackups(prev => prev.filter(b => b.key !== key))
    const result = await apiDeleteBackup(name, key)
    if (result.ok) {
      void fetchBackups()
    } else {
      setDeleteError('Delete failed — check server logs')
      void fetchBackups()
    }
  }

  async function triggerBackup() {
    setTriggering(true)
    try {
      await apiTriggerBackup(name)
      await fetchBackups()
    } finally {
      setTriggering(false)
    }
  }

  async function downloadBackup(key: string) {
    const url = await getBackupDownloadUrl(name, key)
    window.open(url, '_blank')
  }

  return { backups, loading, triggering, error, deleteError, fetchBackups, deleteBackup, triggerBackup, downloadBackup }
}
