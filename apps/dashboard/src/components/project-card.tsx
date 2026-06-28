'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { ProjectSummary, ProjectStatus, CiStatus, DeployStatus } from '@/lib/api'
import { getCiStatus, getDeployStatus } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Meter } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { deriveHealth } from '@/lib/health'
import { useUptimePct } from '@/lib/use-uptime-pct'
import { useDiskTrend } from '@/lib/use-disk-trend'

function usePipelineStatus(name: string): { ciStatus: CiStatus | null; deployStatus: DeployStatus | null } {
  const [ciStatus, setCiStatus] = useState<CiStatus | null>(null)
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      const [ci, deploy] = await Promise.all([getCiStatus(name), getDeployStatus(name)])
      if (!cancelled) { setCiStatus(ci); setDeployStatus(deploy) }
    }
    void poll()
    const id = setInterval(() => void poll(), 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return { ciStatus, deployStatus }
}

interface Props {
  project: ProjectSummary
  status: ProjectStatus | null
  onRetry?: () => Promise<void>
}

function sslDaysLeft(expiry: string | null | undefined): { value: string; color?: string; days: number } {
  if (!expiry) return { value: '—', days: Infinity }
  const expiryDate = new Date(expiry)
  if (isNaN(expiryDate.getTime())) return { value: '—', days: Infinity }
  const days = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { value: 'Expired', color: 'var(--err)', days }
  if (days < 7) return { value: `${days}d`, color: 'var(--err)', days }
  if (days < 30) return { value: `${days}d`, color: 'var(--warn, #e5a00d)', days }
  return { value: `${days}d`, color: 'var(--ok, #22c55e)', days }
}

function deployedAgo(epoch: string | null | undefined): string {
  if (!epoch) return ''
  const secs = Math.floor(Date.now() / 1000) - parseInt(epoch, 10)
  if (isNaN(secs) || secs < 0) return ''
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function ProjectCard({ project, status, onRetry }: Props) {
  const [retrying, setRetrying] = useState(false)
  const { name, domain, region } = project.config
  const { variant, label } = deriveHealth(status)
  const uptimePct = useUptimePct(name)
  const diskTrend = useDiskTrend(name)
  const showDiskWarning = diskTrend !== null
    && diskTrend.projectedDaysUntilFull !== null
    && diskTrend.projectedDaysUntilFull <= 30
    && diskTrend.disk > 75
  const { ciStatus, deployStatus } = usePipelineStatus(name)
  const ciProgress = ciStatus?.status === 'running' ? ciStatus.progress : null
  const deployProgress = deployStatus?.status === 'deploying' ? deployStatus.progress : null
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
        {ciProgress != null && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            running · {ciProgress.pct}%
          </span>
        )}
        {deployProgress != null && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            deploying · {deployProgress.pct}%
          </span>
        )}
        {deployedAgoStr && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded text-subtle" style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            {deployedAgoStr}
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
          <span>SSH unreachable — last seen 2h ago</span>
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
        <span className="text-[12px] font-mono text-subtle flex items-center gap-1.5 whitespace-nowrap shrink-0">
          <Icon name="box" size={13} />
          {status?.containerTotal != null ? `${status.containerCount ?? 0}/${status.containerTotal} running` : '— running'}
        </span>
      </div>
    </Link>
  )
}
