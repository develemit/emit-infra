'use client'
import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/icon'
import type { ProjectSummary } from '@/lib/api'
import { updateBackupRetainDays, getBackupStatus } from '@/lib/api'
import type { useBackups } from '@/lib/use-backups'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function BackupSparkline({ sizes }: { sizes: number[] }) {
  if (sizes.length < 2) return null

  const W = 120, H = 32
  const min = Math.min(...sizes)
  const max = Math.max(...sizes)
  const range = max - min || 1

  const pts = sizes.map((v, i) => {
    const x = (i / (sizes.length - 1)) * W
    const y = H - ((v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ageLabel(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

type BackupsHook = ReturnType<typeof useBackups>

interface BackupPanelProps {
  project: ProjectSummary
  backups: BackupsHook
}

export function BackupPanel({ project, backups }: BackupPanelProps) {
  const { backups: list, loading, triggering, error, deleteError, deleteBackup, triggerBackup, downloadBackup, fetchBackups } = backups
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [retainDays, setRetainDays] = useState<number>(project.config.postgres?.backupRetainDays ?? 7)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [runningBackup, setRunningBackup] = useState(false)
  const [triggerTime, setTriggerTime] = useState<number | null>(null)
  const [backupResult, setBackupResult] = useState<'complete' | 'failed' | 'timeout' | null>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!runningBackup || !triggerTime) return
    pollRef.current = setInterval(async () => {
      const status = await getBackupStatus(project.config.name).catch(() => null)
      if (status && new Date(status.lastRun).getTime() > triggerTime) {
        if (pollRef.current) clearInterval(pollRef.current)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        setRunningBackup(false)
        setBackupResult(status.status === 'ok' ? 'complete' : 'failed')
        void fetchBackups()
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
  }, [runningBackup, triggerTime, project.config.name, fetchBackups])

  useEffect(() => {
    if (!runningBackup) { setElapsedSecs(0); return }
    const id = setInterval(() => setElapsedSecs(s => s + 1), 1_000)
    return () => clearInterval(id)
  }, [runningBackup])

  function fmtElapsed(secs: number): string {
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  }

  async function handleTriggerBackup() {
    setBackupResult(null)
    setElapsedSecs(0)
    setTriggerTime(Date.now())
    setRunningBackup(true)
    try {
      await triggerBackup()
    } catch {
      setRunningBackup(false)
    }
  }

  async function handleSaveRetainDays() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateBackupRetainDays(project.config.name, retainDays)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteClick(key: string) {
    if (confirmKey === key) {
      setConfirmKey(null)
      void deleteBackup(key)
    } else {
      setConfirmKey(key)
    }
  }

  const ageHoursThreshold = project.config.warnThresholds?.backupAgeHours ?? 24
  const newestModified = list.length > 0
    ? Math.max(...list.map(b => new Date(b.lastModified).getTime()))
    : null
  const backupStale = newestModified !== null && (Date.now() - newestModified) > ageHoursThreshold * 3_600_000

  const sortedByAge = [...list].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
  const sizes = sortedByAge.reverse().map(b => b.sizeBytes)
  const oldestSize = sizes.length > 0 ? sizes[0] : 0
  const newestSize = sizes.length > 0 ? sizes[sizes.length - 1] : 0
  const deltaBytesAbsolute = Math.abs(newestSize - oldestSize)
  const deltaMB = deltaBytesAbsolute / (1024 * 1024)
  const deltaSign = newestSize > oldestSize ? '+' : newestSize < oldestSize ? '−' : null
  const deltaColor = newestSize > oldestSize ? 'var(--warn)' : newestSize < oldestSize ? 'var(--ok)' : undefined

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Backups</span>
        <div className="flex-1" />
        {sizes.length >= 2 && (
          <div className="flex flex-col items-center gap-1 mr-3">
            <span className="text-[11px] text-subtle">Size trend</span>
            <div className="flex items-center gap-1.5">
              <BackupSparkline sizes={sizes} />
              {deltaSign && (
                <span className="text-[11px] font-medium" style={{ color: deltaColor }}>
                  {deltaSign}{deltaMB.toFixed(1)} MB
                </span>
              )}
            </div>
          </div>
        )}
        <button
          onClick={() => void handleTriggerBackup()}
          disabled={triggering || runningBackup}
          className="inline-flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {triggering || runningBackup
            ? <><Icon name="refresh" size={12} />Running… {fmtElapsed(elapsedSecs)}</>
            : backupResult === 'timeout'
            ? <><Icon name="alert" size={12} />Status unknown — check logs</>
            : backupResult === 'complete'
            ? <><Icon name="check" size={12} />Backup complete</>
            : backupResult === 'failed'
            ? <><Icon name="alert" size={12} />Backup failed</>
            : <><Icon name="deploy" size={12} />Back up now</>
          }
        </button>
      </div>

      {backupStale && !loading && (
        <div className="text-[12px] text-warn font-mono mb-3">
          Latest backup is older than {ageHoursThreshold}h — consider running a backup now
        </div>
      )}

      {error && (
        <div className="text-[12px] text-err font-mono mb-3">{error}</div>
      )}

      {deleteError && (
        <div className="text-[12px] text-err font-mono mb-3">{deleteError}</div>
      )}

      {loading ? (
        <div className="text-[12px] text-subtle font-mono">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-[12px] text-subtle font-mono">No backups found</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {list.map(b => (
            <div key={b.key} className="flex items-center gap-3 py-2.5">
              <span className="font-mono text-[12px] text-fg flex-1 truncate">{b.key}</span>
              <span className="font-mono text-[12px] text-subtle shrink-0">{formatBytes(b.sizeBytes)}</span>
              <span className="font-mono text-[12px] text-faint shrink-0 w-16 text-right">{ageLabel(b.lastModified)}</span>
              <button
                onClick={() => void downloadBackup(b.key)}
                className="text-subtle hover:text-fg transition-colors shrink-0"
                title="Download"
              >
                <Icon name="download" size={14} />
              </button>
              <button
                onClick={() => handleDeleteClick(b.key)}
                onBlur={() => { if (confirmKey === b.key) setConfirmKey(null) }}
                className={`shrink-0 text-[11px] font-medium transition-colors ${confirmKey === b.key ? 'text-err' : 'text-subtle hover:text-err'}`}
                title="Delete"
              >
                {confirmKey === b.key ? 'Confirm?' : <Icon name="trash" size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
        <span className="text-[12px] text-subtle shrink-0">Retain backups for</span>
        <input
          type="number"
          min={1}
          max={365}
          value={retainDays}
          onChange={e => setRetainDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
          className="w-16 px-2 h-[28px] rounded-lg border border-border bg-card text-[12px] font-mono text-fg text-center"
        />
        <span className="text-[12px] text-subtle shrink-0">days</span>
        <button
          onClick={() => void handleSaveRetainDays()}
          disabled={saving}
          className="px-3 h-[28px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && <span className="text-[12px] text-err font-mono">{saveError}</span>}
      </div>
    </div>
  )
}
