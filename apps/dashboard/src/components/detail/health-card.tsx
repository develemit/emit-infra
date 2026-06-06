import { Icon } from '@/components/icon'
import { Meter } from '@/components/ui/meter'
import type { ProjectSummary, ProjectStatus } from '@/lib/api'

interface StatTileProps {
  icon: string
  label: string
  value: string
  mono?: boolean
  color?: string
}

function StatTile({ icon, label, value, mono = true, color }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-subtle flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className={`text-[14px] font-semibold${mono ? ' font-mono' : ''}`}
        style={{ letterSpacing: mono ? 0 : undefined, color: color ?? 'var(--fg)' }}
      >
        {value}
      </span>
    </div>
  )
}

function sslDaysLeft(expiry: string | null | undefined): { value: string; color?: string } {
  if (!expiry) return { value: '—' }
  const expiryDate = new Date(expiry)
  if (isNaN(expiryDate.getTime())) return { value: '—' }
  const days = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { value: 'Expired', color: 'var(--err)' }
  if (days < 14) return { value: `${days}d`, color: 'var(--warn, #e5a00d)' }
  return { value: `${days}d` }
}

function nginxLabel(status: string | null | undefined): { value: string; color?: string } {
  if (!status) return { value: '—' }
  if (status === 'active') return { value: 'Active', color: 'var(--ok, #22c55e)' }
  return { value: 'Down', color: 'var(--err)' }
}

function redisLabel(status: string | null | undefined): { value: string; color?: string } {
  if (!status) return { value: '—' }
  if (status === 'healthy') return { value: 'Healthy', color: 'var(--ok, #22c55e)' }
  return { value: 'Down', color: 'var(--err)' }
}

interface HealthCardProps {
  project: ProjectSummary
  status: ProjectStatus
  polledAgo?: string
}

function sizeLabel(label: string, used?: string, total?: string): string {
  if (used && total) return `${label} · ${used} / ${total}`
  return label
}

export function HealthCard({ project, status, polledAgo }: HealthCardProps) {
  const disk = status.disk ?? 0
  const mem = status.memory ?? 0
  const diskLabel = sizeLabel('Disk', status.diskUsed, status.diskTotal)
  const memLabel = sizeLabel('Memory', status.memUsed, status.memTotal)
  const uptime = status.uptime?.replace('up ', '') ?? '—'
  const region = status.region ?? project.config.region
  const serverType = status.serverType ?? '—'
  const ip = status.ip ?? '—'
  const nginx = nginxLabel(status.nginxStatus)
  const ssl = sslDaysLeft(status.sslExpiry)
  const redis = redisLabel(status.redisStatus)

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Icon name="server" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Server Health</span>
        <div className="flex-1" />
        {polledAgo && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-subtle rounded-full px-2.5 py-1"
            style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}
          >
            <Icon name="refresh" size={12} />
            {polledAgo}
          </span>
        )}
      </div>

      {/* Desktop: 4-col stat grid */}
      <div className="hidden lg:grid grid-cols-4 gap-4 mb-5">
        <StatTile icon="clock" label="Uptime" value={uptime} mono={false} />
        <StatTile icon="globe" label="Region" value={region} />
        <StatTile icon="cpu" label="Server" value={serverType} />
        <StatTile icon="link" label="Public IP" value={ip} />
        <StatTile icon="hash" label="Build" value={status.buildNumber ?? '—'} />
        <StatTile icon="shield" label="Nginx" value={nginx.value} color={nginx.color} />
        <StatTile icon="lock" label="SSL" value={ssl.value} color={ssl.color} />
        {status.redisStatus && <StatTile icon="database" label="Redis" value={redis.value} color={redis.color} />}
      </div>

      {/* Mobile: 2-col stat grid */}
      <div className="lg:hidden grid grid-cols-2 gap-4 mb-5">
        <StatTile icon="clock" label="Uptime" value={uptime} mono={false} />
        <StatTile icon="globe" label="Region" value={region} />
        <StatTile icon="hash" label="Build" value={status.buildNumber ?? '—'} />
        <StatTile icon="shield" label="Nginx" value={nginx.value} color={nginx.color} />
        {status.redisStatus && <StatTile icon="database" label="Redis" value={redis.value} color={redis.color} />}
      </div>

      {/* Desktop: side-by-side lg meters */}
      <div className="hidden lg:flex gap-6">
        <div className="flex-1"><Meter label={diskLabel} value={disk} lg /></div>
        <div className="flex-1"><Meter label={memLabel} value={mem} lg /></div>
      </div>

      {/* Mobile: stacked lg meters */}
      <div className="lg:hidden flex flex-col gap-3">
        <Meter label={diskLabel} value={disk} lg />
        <Meter label={memLabel} value={mem} lg />
      </div>
    </div>
  )
}
