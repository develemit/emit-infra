'use client'
import Link from 'next/link'
import type { ProjectSummary, ProjectStatus } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Meter } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  project: ProjectSummary
  status: ProjectStatus | null
}

function deriveVariant(status: ProjectStatus | null): BadgeVariant {
  if (status === null) return 'muted'
  if (status.error) return 'err'
  const disk = parseInt(status.disk ?? '0', 10)
  const mem = parseInt(status.memory ?? '0', 10)
  if (disk >= 80 || mem >= 80) return 'warn'
  return 'ok'
}

const variantLabel: Record<BadgeVariant, string> = {
  ok: 'Healthy',
  warn: 'Degraded',
  err: 'Unreachable',
  muted: 'Loading',
  accent: 'Accent',
  region: 'Region',
}

export function ProjectCard({ project, status }: Props) {
  const { name, domain, region } = project.config
  const variant = deriveVariant(status)
  const reachable = variant === 'ok' || variant === 'warn'
  const loading = status === null
  const disk = status?.disk ? parseInt(status.disk, 10) : 0
  const mem = status?.memory ? parseInt(status.memory, 10) : 0

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
          </div>
        </div>
        <Badge variant={variant} dot loading={loading}>
          {variantLabel[variant]}
        </Badge>
      </div>

      {/* Region badge */}
      <div className="flex gap-1.5">
        <Badge variant="region">{region}</Badge>
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
          {loading ? '— running' : '— running'}
        </span>
      </div>
    </Link>
  )
}
