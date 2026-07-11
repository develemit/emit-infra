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
  type CiHistoryEntry,
} from '@/lib/api'
import {
  type FleetRow,
  pctColor,
  ciColor,
  sslColor,
  sslLabel,
  backupColor,
  backupLabel,
  deployAge,
  rowLevel,
  httpColor,
} from './helpers'
import { FilterTabs } from '@/components/ui/filter-tabs'

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
        <div className="flex-1" />
        <Link href="/health/incidents" className="flex items-center gap-1.5 text-[12px] text-subtle hover:text-fg transition-colors font-mono">
          <Icon name="activity" size={13} />
          Incidents
        </Link>
      </div>

      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 px-5 pt-5 pb-3">
        <Icon name="layers" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Fleet Health</span>
      </div>

      <div className="px-5 md:px-8 py-5">
        {/* Filter buttons */}
        <FilterTabs
          tabs={[
            { value: 'all', label: 'All', count: rows?.length },
            { value: 'warn', label: 'Warning', count: rows ? rows.filter(r => rowLevel(r) !== 'ok' && rowLevel(r) !== 'fail').length : undefined },
            { value: 'fail', label: 'Failing', count: rows ? rows.filter(r => rowLevel(r) === 'fail').length : undefined },
          ]}
          value={filter}
          onChange={v => setFilter(v as 'all' | 'warn' | 'fail')}
        />
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
