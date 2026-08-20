'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { ProjectSummary, ProjectStatus } from '@/lib/api-projects'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Meter } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { deriveHealth } from '@/lib/health'
import { useUptimePct } from '@/lib/use-uptime-pct'
import { useDiskTrend } from '@/lib/use-disk-trend'
import { sslDaysLeft, deployedAgo } from '@/lib/date-helpers'
import { usePipelineStatus, runStateOf } from '@/lib/use-pipeline-status'
import type { CiProgress, RunState } from '@/lib/api-containers'

interface Props {
  project: ProjectSummary
  status: ProjectStatus | null
  onRetry?: () => Promise<void>
}

interface PipelineChip {
  text: string
  color: string
}

// `verb`/`phase` differ only in wording ("running"/"deploying" while live vs
// "ci"/"deploy" once orphaned or unknown) — the live case keeps today's exact
// copy, the other two states borrow pipeline-progress-card's wording.
function pipelineChip(phase: 'ci' | 'deploy', verb: string, state: RunState, progress?: CiProgress | null): PipelineChip | null {
  switch (state) {
    case 'running':
      return { text: progress != null ? `${verb} · ${progress.pct}%` : verb, color: 'var(--accent)' }
    case 'orphaned':
      return { text: `${phase} orphaned`, color: 'var(--err)' }
    case 'unknown':
      return { text: `${phase} unknown`, color: 'var(--fg-muted)' }
    default:
      return null
  }
}

export function ProjectCard({ project, status, onRetry }: Props) {
  const [retrying, setRetrying] = useState(false)
  const { name, domain, region } = project.config
  const { variant, label } = deriveHealth(status, project.config.warnThresholds)
  const uptimePct = useUptimePct(name)
  const diskTrend = useDiskTrend(name)
  const showDiskWarning = diskTrend !== null
    && diskTrend.projectedDaysUntilFull !== null
    && diskTrend.projectedDaysUntilFull <= 30
    && diskTrend.disk > 75
  const { ci, deploy } = usePipelineStatus(name)
  const ciChip = pipelineChip('ci', 'running', runStateOf(ci), ci?.progress)
  const deployChip = pipelineChip('deploy', 'deploying', runStateOf(deploy), deploy?.progress)
  const reachable = status !== null && !status.error
  const loading = status === null
  const disk = status?.disk ?? 0
  const mem = status?.memory ?? 0
  const ssl = sslDaysLeft(status?.sslExpiry)
  const deployedAgoStr = deployedAgo(status?.deployedAt)

  return (
    <Link
      href={`/projects/${encodeURIComponent(name)}`}
      className="flex flex-col rounded-xl border border-border bg-card hover:bg-card-hover hover:border-strong transition-[background-color,border-color] duration-150"
      style={{ padding: 16, gap: 13 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-fg truncate">{name}</div>
          <div className="text-[12px] font-mono text-muted flex items-center gap-1.5 mt-0.5">
            <Icon name="globe" size={12} style={{ opacity: 0.6 }} />
            <span className="truncate">{domain}</span>
            {status?.buildNumber && (
              <span className="text-subtle whitespace-nowrap">v{status.buildNumber}</span>
            )}
          </div>
        </div>
        <Badge variant={variant} dot loading={loading}>
          {label}
        </Badge>
      </div>

      {/* Region badge */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="region">{region}</Badge>
        {status?.sslExpiry && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: ssl.color, background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            SSL {ssl.value}
          </span>
        )}
        {uptimePct != null && (
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
            style={{
              color: uptimePct < 95 ? 'var(--err)' : 'var(--subtle)',
              background: 'var(--card-2)',
              border: '1px solid var(--border)',
            }}
          >
            {uptimePct}% up
          </span>
        )}
        {showDiskWarning && (
          <span
            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
            style={{ color: 'var(--warn, #e5a00d)', background: 'var(--card-2)', border: '1px solid var(--border)' }}
          >
            disk full ~{Math.round(diskTrend!.projectedDaysUntilFull!)}d
          </span>
        )}
        {ciChip && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: ciChip.color, background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            {ciChip.text}
          </span>
        )}
        {deployChip && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: deployChip.color, background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            {deployChip.text}
          </span>
        )}
      </div>

      {/* Meters / skeleton / unreachable */}
      {reachable ? (
        <div className="flex gap-4">
          <div className="flex-1"><Meter label="Disk" value={disk} /></div>
          <div className="flex-1"><Meter label="Mem" value={mem} /></div>
        </div>
      ) : loading ? (
        <div className="flex gap-4">
          <Skeleton className="h-[34px] flex-1" />
          <Skeleton className="h-[34px] flex-1" />
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-err border border-err-line bg-err-soft"
        >
          <Icon name="alert" size={15} style={{ color: 'var(--err)', flexShrink: 0 }} />
          <span>SSH unreachable — last seen {deployedAgoStr && deployedAgoStr !== '—' ? `${deployedAgoStr.replace(' ago', '')} ago` : '—'}</span>
          {onRetry && (
            <button
              type="button"
              disabled={retrying}
              className="ml-auto text-[11px] font-mono text-err hover:text-fg disabled:opacity-50 transition-colors"
              onClick={async () => {
                setRetrying(true)
                await onRetry()
                setRetrying(false)
              }}
            >
              {retrying ? '…' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-mono text-subtle flex items-center gap-1.5 min-w-0">
          <Icon name="clock" size={13} className="shrink-0" />
          <span className="truncate">{status?.uptime ?? '—'}</span>
        </span>
        {deployedAgoStr && deployedAgoStr !== '—' && (
          <span className="text-[12px] font-mono text-subtle flex items-center gap-1 whitespace-nowrap shrink-0">
            <Icon name="deploy" size={13} />
            {deployedAgoStr}
          </span>
        )}
        <span className="text-[12px] font-mono text-subtle flex items-center gap-1.5 whitespace-nowrap shrink-0">
          <Icon name="box" size={13} />
          {status?.containerTotal != null ? `${status.containerCount ?? 0}/${status.containerTotal} running` : '— running'}
        </span>
      </div>
    </Link>
  )
}
