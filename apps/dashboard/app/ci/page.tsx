'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { getProjects, getCiHistory } from '@/lib/api'
import { formatDuration } from '@/lib/format-duration'
import type { ProjectSummary, CiHistoryEntry } from '@/lib/api'

interface ProjectCiStats {
  name: string
  passRate: number
  avgDuration: number
  lastStatus: string | null
  lastRun: string | null
  total: number
}

function deriveStats(name: string, runs: CiHistoryEntry[]): ProjectCiStats {
  const total = runs.length
  if (total === 0) {
    return { name, passRate: -1, avgDuration: 0, lastStatus: null, lastRun: null, total: 0 }
  }
  const successes = runs.filter(r => r.status !== 'failure').length
  const avgDuration = Math.round(runs.reduce((a, r) => a + r.durationSec, 0) / total)
  return {
    name,
    passRate: successes / total,
    avgDuration,
    lastStatus: runs[0]?.status ?? null,
    lastRun: runs[0]?.completedAt ?? null,
    total,
  }
}

function rateColor(rate: number): string {
  if (rate < 0) return 'var(--fg-muted)'
  if (rate >= 0.9) return 'var(--ok, #22c55e)'
  if (rate >= 0.7) return '#f59e0b'
  return 'var(--err)'
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 border-t border-border first:border-t-0">
      <div className="w-24 h-4 rounded bg-card-2 animate-pulse" />
      <div className="w-16 h-4 rounded bg-card-2 animate-pulse" />
      <div className="w-16 h-4 rounded bg-card-2 animate-pulse" />
      <div className="w-28 h-4 rounded bg-card-2 animate-pulse" />
      <div className="w-16 h-4 rounded bg-card-2 animate-pulse" />
    </div>
  )
}

export default function CiPage() {
  const [stats, setStats] = useState<ProjectCiStats[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const projects = await getProjects()
      const results = await Promise.all(
        projects.map(async (p: ProjectSummary) => {
          try {
            const history = await getCiHistory(p.config.name, 30)
            return deriveStats(p.config.name, history.runs)
          } catch {
            return deriveStats(p.config.name, [])
          }
        }),
      )
      if (!cancelled) {
        results.sort((a, b) => {
          if (a.total === 0 && b.total === 0) return 0
          if (a.total === 0) return 1
          if (b.total === 0) return -1
          return a.passRate - b.passRate
        })
        setStats(results)
      }
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="min-h-screen">
      {/* Desktop topbar */}
      <div className="hidden md:flex items-center gap-4 px-8 border-b border-border bg-elev"
        style={{ height: 56 }}>
        <Icon name="zap" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">CI Overview</span>
        {stats && (
          <Badge variant="muted" mono className="ml-1">{stats.length} projects</Badge>
        )}
      </div>

      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 px-5 pt-5 pb-3">
        <Icon name="zap" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">CI Overview</span>
      </div>

      <div className="px-5 md:px-8 py-5">
        {/* Desktop table */}
        <div className="hidden md:block rounded-xl border border-border bg-card" style={{ padding: 18 }}>
          <div className="flex items-center gap-4 pb-3 text-[11px] font-mono text-subtle uppercase tracking-wider">
            <div className="w-36">Project</div>
            <div className="w-24">Pass rate</div>
            <div className="w-24">Avg duration</div>
            <div className="w-36">Last run</div>
            <div className="w-24">Last status</div>
          </div>

          {stats === null ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            stats.map(s => (
              <div
                key={s.name}
                className="flex items-center gap-4 py-3 border-t border-border"
              >
                <div className="w-36 text-[13px] font-medium text-fg truncate"><Link href={`/projects/${encodeURIComponent(s.name)}`} className="hover:underline">{s.name}</Link></div>
                <div className="w-24">
                  {s.total === 0 ? (
                    <span className="text-[12px] text-subtle font-mono">no runs</span>
                  ) : (
                    <span className="text-[13px] font-mono font-medium" style={{ color: rateColor(s.passRate) }}>
                      {Math.round(s.passRate * 100)}%
                    </span>
                  )}
                </div>
                <div className="w-24 text-[12px] font-mono text-subtle">
                  {s.total > 0 ? formatDuration(s.avgDuration) : '—'}
                </div>
                <div className="w-36 text-[12px] font-mono text-subtle">
                  {s.lastRun ? formatTimestamp(s.lastRun) : '—'}
                </div>
                <div className="w-24">
                  {s.lastStatus ? (
                    <Badge variant={s.lastStatus === 'failure' ? 'err' : 'ok'} dot>
                      {s.lastStatus}
                    </Badge>
                  ) : (
                    <span className="text-[12px] text-subtle">—</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Mobile cards */}
        <div className="md:hidden flex flex-col gap-3">
          {stats === null ? (
            <>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <div className="w-24 h-4 rounded bg-card-2 animate-pulse mb-3" />
                  <div className="w-full h-3 rounded bg-card-2 animate-pulse" />
                </div>
              ))}
            </>
          ) : (
            stats.map(s => (
              <div key={s.name} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <Link href={`/projects/${encodeURIComponent(s.name)}`} className="text-[13px] font-medium text-fg hover:underline">{s.name}</Link>
                  {s.lastStatus && (
                    <Badge variant={s.lastStatus === 'failure' ? 'err' : 'ok'} dot>
                      {s.lastStatus}
                    </Badge>
                  )}
                </div>
                {s.total === 0 ? (
                  <span className="text-[12px] text-subtle font-mono">no runs</span>
                ) : (
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span style={{ color: rateColor(s.passRate) }}>
                      {Math.round(s.passRate * 100)}% pass
                    </span>
                    <span className="text-subtle">·</span>
                    <span className="text-subtle">avg {formatDuration(s.avgDuration)}</span>
                    {s.lastRun && (
                      <>
                        <span className="text-subtle">·</span>
                        <span className="text-subtle">{formatTimestamp(s.lastRun)}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
