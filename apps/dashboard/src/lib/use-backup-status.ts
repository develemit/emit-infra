'use client'
import { useState, useEffect } from 'react'
import { getBackupStatus, type BackupStatus } from './api'

export function useBackupStatus(name: string): BackupStatus | null {
  const [status, setStatus] = useState<BackupStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      const result = await getBackupStatus(name).catch(() => null)
      if (!cancelled) setStatus(result)
    }
    void fetch()
    const id = setInterval(() => void fetch(), 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return status
}
