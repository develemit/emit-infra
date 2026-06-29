'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import {
  getProjects,
  getStatus,
  getCiHistory,
  getBackupStatus,
  type ProjectSummary,
  type ProjectStatus,
  type BackupStatus,
  type CiHistoryEntry,
} from '@/lib/api'

interface FleetRow {
  name: string
  status: ProjectStatus | null
  ciPassRate: number | null
  backup: BackupStatus | null
}

function pctColor(pct: number | undefined): string {
  if (pct === undefined) return 'var(--fg-muted)'
  if (pct > 90) return 'var(--err)'
  if (pct > 75) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

function ciColor(rate: number | null): string {
  if (rate === null) return 'var(--fg-muted)'
  if (rate >= 0.9) return 'var(--ok, #22c55e)'
  if (rate >= 0.7) return '#f59e0b'
  return 'var(--err)'
}

function sslDays(expiry: string | null | undefined): number | null {
  if (!expiry) return null
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
}

function sslColor(expiry: string | null | undefined): string {
  const days = sslDays(expiry)
  if (days === null) return 'var(--fg-muted)'
  if (days < 7) return 'var(--err)'
  if (days < 30) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

function sslLabel(expiry: string | null | undefined): string {
  const days = sslDays(expiry)
  if (days === null) return '—'
  if (days < 0) return 'Expired'
  return `${days}d`
}

function backupAgeHours(lastRun: string | undefined): number | null {
  if (!lastRun) return null
  return (Date.now() - new Date(lastRun).getTime()) / 3600000
}

function backupColor(lastRun: string | undefined): string {
  const h = backupAgeHours(lastRun)
  if (h === null) return 'var(--fg-muted)'
  if (h > 49) return 'var(--err)'
  if (h > 25) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

function backupLabel(lastRun: string | undefined, status: string | undefined): string {
  const h = backupAgeHours(lastRun)
  if (h === null) return '—'
  const age = h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`
  return status === 'failed' ? `${age} (failed)` : age
}

function deployAge(deployedAt: string | null | undefined): string {
  if (!deployedAt) return '—'
  const h = (Date.now() - new Date(deployedAt).getTime()) / 3600000
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h >= 1) return `${Math.floor(h)}h ago`
  return 'just now'
}

function rowLevel(r: FleetRow): 'fail' | 'warn' | 'ok' {
  const disk = r.status?.disk
  const mem = r.status?.memory
  const http = r.status?.httpStatus
  const bh = backupAgeHours(r.backup?.lastRun)
  const ssl = sslDays(r.status?.sslExpiry)
  if (disk !== undefined && disk > 90) return 'fail'
  if (mem !== undefined && mem > 90) return 'fail'
  if (http != null && (http < 200 || http >= 400)) return 'fail'
  if (r.ciPassRate !== null && r.ciPassRate < 0.7) return 'fail'
  if (bh !== null && bh > 49) return 'fail'
  if (r.backup?.status === 'failed') return 'fail'
  if (disk !== undefined && disk > 75) return 'warn'
  if (mem !== undefined && mem > 75) return 'warn'
  if (http != null && http >= 300) return 'warn'
  if (r.ciPassRate !== null && r.ciPassRate < 0.9) return 'warn'
  if (bh !== null && bh > 25) return 'warn'
  if (ssl !== null && ssl < 30) return 'warn'
  return 'ok'
}

function httpColor(code: number | null | undefined): string {
  if (code == null) return 'var(--fg-muted)'
  if (code >= 200 && code < 300) return 'var(--ok, #22c55e)'
  if (code >= 300 && code < 400) return '#f59e0b'
  return 'var(--err)'
}

function SkeletonRow() {
  return (
    <tr className="border-t border-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="py-3 pr-4">
          <div className="h-3 w-14 rounded bg-card-2 animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function FleetHealthPage() {
  const [rows, setRows] = useState<FleetRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'warn' | 'fail'>('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const projects = await getProjects()
      const results = await Promise.all(
        projects.map(async (p: ProjectSummary): Promise<FleetRow> => {
          const name = p.config.name
          const [status, ciHistory, backup] = await Promise.all([
            getStatus(name).catch(() => null),
            getCiHistory(name, 20).catch(() => null),
            getBackupStatus(name).catch(() => null),
          ])
          const runs = ciHistory?.runs ?? []
          const ciPassRate = runs.length > 0
            ? runs.filter((r: CiHistoryEntry) => r.status !== 'failure').length / runs.length
            : null
          return { name, status, ciPassRate, backup }
        }),
      )
      if (!cancelled) setRows(results)
    }
    void load()
    const interval = setInterval(() => void load(), 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return (
    <div className="min-h-screen">
      {/* Desktop topbar */}
      <div className="hidden md:flex items-center gap-4 px-8 border-b border-border bg-elev" style={{ height: 56 }}>
        <Icon name="layers" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Fleet Health</span>
        {rows && <Badge variant="muted" mono className="ml-1">{rows.length} projects</Badge>}
      </div>

      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 px-5 pt-5 pb-3">
        <Icon name="layers" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Fleet Health</span>
      </div>

      <div className="px-5 md:px-8 py-5">
        {/* Filter buttons */}
        <div className="flex items-center gap-1 mb-4">
          {rows && (() => {
            const failCount = rows.filter(r => rowLevel(r) === 'fail').length
            const warnCount = rows.filter(r => rowLevel(r) !== 'ok' && rowLevel(r) !== 'fail').length
            const allCount = rows.length
            return (
              <>
                {(['all', 'warn', 'fail'] as const).map(f => {
                  const count = f === 'all' ? allCount : f === 'warn' ? warnCount : failCount
                  const label = f === 'all' ? 'All' : f === 'warn' ? 'Warning' : 'Failing'
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`text-[12px] font-mono px-3 py-1 rounded-lg border transition-colors ${
                        filter === f
                          ? 'bg-card-2 border-border text-fg'
                          : 'border-transparent text-subtle hover:text-fg hover:border-border'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  )
                })}
              </>
            )
          })()}
          {!rows && (
            <>
              {(['all', 'warn', 'fail'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[12px] font-mono px-3 py-1 rounded-lg border transition-colors ${
                    filter === f
                      ? 'bg-card-2 border-border text-fg'
                      : 'border-transparent text-subtle hover:text-fg hover:border-border'
                  }`}
                  disabled
                >
                  {f === 'all' ? 'All' : f === 'warn' ? 'Warning' : 'Failing'}
                </button>
              ))}
            </>
          )}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block rounded-xl border border-border bg-card overflow-x-auto" style={{ padding: 18 }}>
          <table className="w-full">
            <thead>
              <tr>
                {['Project', 'HTTP', 'Disk', 'Memory', 'SSL', 'Last Deploy', 'CI Pass', 'Backup'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-subtle pb-3 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
              ) : rows.filter(r => filter === 'all' || (filter === 'fail' ? rowLevel(r) === 'fail' : rowLevel(r) !== 'ok')).map(r => (
                <tr key={r.name} className="border-t border-border hover:bg-card-hover transition-colors">
                  <td className="py-3 pr-4">
                    <Link href={`/projects/${encodeURIComponent(r.name)}`} className="font-mono text-[13px] font-medium text-fg hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px]" style={{ color: httpColor(r.status?.httpStatus) }}>
                    {r.status?.httpStatus ?? '—'}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px]" style={{ color: pctColor(r.status?.disk) }}>
                    {r.status?.disk !== undefined ? `${r.status.disk.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px]" style={{ color: pctColor(r.status?.memory) }}>
                    {r.status?.memory !== undefined ? `${r.status.memory.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px]" style={{ color: sslColor(r.status?.sslExpiry) }}>
                    {sslLabel(r.status?.sslExpiry)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px] text-subtle whitespace-nowrap">
                    {deployAge(r.status?.deployedAt)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12px]" style={{ color: ciColor(r.ciPassRate) }}>
                    {r.ciPassRate !== null ? `${Math.round(r.ciPassRate * 100)}%` : '—'}
                  </td>
                  <td className="py-3 font-mono text-[12px]" style={{ color: backupColor(r.backup?.lastRun) }}>
                    {backupLabel(r.backup?.lastRun, r.backup?.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden flex flex-col gap-3">
          {rows === null ? (
            [1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="w-24 h-4 rounded bg-card-2 animate-pulse mb-3" />
                <div className="w-full h-3 rounded bg-card-2 animate-pulse" />
              </div>
            ))
          ) : rows.filter(r => filter === 'all' || (filter === 'fail' ? rowLevel(r) === 'fail' : rowLevel(r) !== 'ok')).map(r => (
            <div key={r.name} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <Link href={`/projects/${encodeURIComponent(r.name)}`} className="font-mono text-[13px] font-medium text-fg hover:underline">
                  {r.name}
                </Link>
                <span className="font-mono text-[12px]" style={{ color: httpColor(r.status?.httpStatus) }}>
                  {r.status?.httpStatus ?? '—'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
                <span className="text-subtle">Disk</span>
                <span style={{ color: pctColor(r.status?.disk) }}>{r.status?.disk !== undefined ? `${r.status.disk.toFixed(0)}%` : '—'}</span>
                <span className="text-subtle">Memory</span>
                <span style={{ color: pctColor(r.status?.memory) }}>{r.status?.memory !== undefined ? `${r.status.memory.toFixed(0)}%` : '—'}</span>
                <span className="text-subtle">SSL</span>
                <span style={{ color: sslColor(r.status?.sslExpiry) }}>{sslLabel(r.status?.sslExpiry)}</span>
                <span className="text-subtle">Deploy</span>
                <span className="text-subtle">{deployAge(r.status?.deployedAt)}</span>
                <span className="text-subtle">CI</span>
                <span style={{ color: ciColor(r.ciPassRate) }}>{r.ciPassRate !== null ? `${Math.round(r.ciPassRate * 100)}%` : '—'}</span>
                <span className="text-subtle">Backup</span>
                <span style={{ color: backupColor(r.backup?.lastRun) }}>{backupLabel(r.backup?.lastRun, r.backup?.status)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
