'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { getBackupStatus } from './api'

type BackupResult = 'complete' | 'failed' | 'timeout'

export function useBackupPolling(projectName: string, fetchBackups: () => void) {
  const [runningBackup, setRunningBackup] = useState(false)
  const [triggerTime, setTriggerTime] = useState<number | null>(null)
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!runningBackup || !triggerTime) return
    pollRef.current = setInterval(async () => {
      const status = await getBackupStatus(projectName).catch(() => null)
      if (status && new Date(status.lastRun).getTime() > triggerTime) {
        if (pollRef.current) clearInterval(pollRef.current)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        setRunningBackup(false)
        setBackupResult(status.status === 'ok' ? 'complete' : 'failed')
        fetchBackups()
      }
    }, 5_000)
    timeoutRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current)
      setRunningBackup(false)
      setBackupResult('timeout')
    }, 600_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [runningBackup, triggerTime, projectName, fetchBackups])

  useEffect(() => {
    if (!runningBackup) { setElapsedSecs(0); return }
    const id = setInterval(() => setElapsedSecs(s => s + 1), 1_000)
    return () => clearInterval(id)
  }, [runningBackup])

  const start = useCallback(() => {
    setBackupResult(null)
    setElapsedSecs(0)
    setTriggerTime(Date.now())
    setRunningBackup(true)
  }, [])

  const abort = useCallback(() => {
    setRunningBackup(false)
  }, [])

  return { runningBackup, backupResult, elapsedSecs, start, abort }
}
