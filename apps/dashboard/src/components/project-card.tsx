'use client'
import Link from 'next/link'
import type { ProjectSummary, ProjectStatus } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Meter } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { deriveHealth } from '@/lib/health'

interface Props {
  project: ProjectSummary
  status: ProjectStatus | null
}

function sslDaysLeft(expiry: string | null | undefined): { value: string; color?: string; days: number } {
  if (!expiry) return { value: '—', days: Infinity }
  const expiryDate = new Date(expiry)
  if (isNaN(expiryDate.getTime())) return { value: '—', days: Infinity }
  const days = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { value: 'Expired', color: 'var(--err)', days }
  if (days < 14) return { value: `${days}d`, color: 'var(--warn, #e5a00d)', days }
  return { value: `${days}d`, days }
}

export function ProjectCard({ project, status }: Props) {
  const { name, domain, region } = project.config
  const { variant, label } = deriveHealth(status)
  const reachable = status !== null && !status.error
  const loading = status === null
  const disk = status?.disk ?? 0
  const mem = status?.memory ?? 0
  const ssl = sslDaysLeft(status?.sslExpiry)

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
      <div className="flex gap-1.5">
        <Badge variant="region">{region}</Badge>
        {status?.sslExpiry && ssl.days <= 30 && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: ssl.color, background: 'var(--card-2)', border: '1px solid var(--border)' }}>
            SSL {ssl.value}
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
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-subtle flex items-center gap-1.5 whitespace-nowrap">
          <Icon name="clock" size={13} />
          {status?.uptime ?? '—'}
        </span>
        <span className="text-[12px] font-mono text-subtle flex items-center gap-1.5 whitespace-nowrap">
          <Icon name="box" size={13} />
          {status?.containerTotal != null ? `${status.containerCount ?? 0}/${status.containerTotal} running` : '— running'}
        </span>
      </div>
    </Link>
  )
}
