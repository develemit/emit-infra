import { Icon } from '@/components/icon'
import { Meter } from '@/components/ui/meter'
import type { ProjectSummary, ProjectStatus, MetricPoint, ScaleAdvice } from '@/lib/api'

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
  if (days < 7) return { value: `${days}d`, color: 'var(--err)' }
  if (days < 30) return { value: `${days}d`, color: 'var(--warn, #e5a00d)' }
  return { value: `${days}d`, color: 'var(--ok, #22c55e)' }
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

function deployedAgo(epoch: string | null | undefined): string {
  if (!epoch) return '—'
  const secs = Math.floor(Date.now() / 1000) - parseInt(epoch, 10)
  if (isNaN(secs) || secs < 0) return '—'
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function queueLabel(failed: number | null | undefined, wait: number | null | undefined): { value: string; color?: string } | null {
  if (failed == null) return null
  if (failed > 0) return { value: `${failed} failed · ${wait ?? 0} waiting`, color: 'var(--err)' }
  if ((wait ?? 0) > 100) return { value: `${wait} waiting`, color: 'var(--warn, #e5a00d)' }
  return { value: `OK · ${wait ?? 0} waiting`, color: 'var(--ok, #22c55e)' }
}

interface HealthCardProps {
  project: ProjectSummary
  status: ProjectStatus
  polledAgo?: string
  onRefresh?: () => void
  uptimePct?: number | null
  latestMetric?: MetricPoint | null
  scaleAdvice?: ScaleAdvice | null
}

function sizeLabel(label: string, used?: string, total?: string): string {
  if (used && total) return `${label} · ${used} / ${total}`
  return label
}

export function HealthCard({ project, status, polledAgo, onRefresh, uptimePct, latestMetric, scaleAdvice }: HealthCardProps) {
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
  const queue = queueLabel(status.queueFailed, status.queueWait)
  const deployed = deployedAgo(status.deployedAt)
  const nginx4xx = latestMetric?.nginx4xx ?? 0
  const nginx5xx = latestMetric?.nginx5xx ?? 0
  const hasNginxErrors = nginx4xx > 0 || nginx5xx > 0

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Icon name="server" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Server Health</span>
        <div className="flex-1" />
        {polledAgo && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-subtle rounded-full px-2.5 py-1 hover:bg-border transition-colors disabled:opacity-50"
            style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}
          >
            <Icon name="refresh" size={12} />
            {polledAgo}
          </button>
        )}
      </div>

      {/* Desktop: 4-col stat grid */}
      <div className="hidden lg:grid grid-cols-4 gap-4 mb-5">
        <StatTile icon="clock" label="Uptime" value={uptime} mono={false} />
        <StatTile icon="globe" label="Region" value={region} />
        <StatTile icon="cpu" label="Server" value={serverType} />
        <StatTile icon="link" label="Public IP" value={ip} />
        <StatTile icon="hash" label="Build" value={status.buildNumber ?? '—'} />
        <StatTile icon="clock" label="Deployed" value={deployed} mono={false} />
        <StatTile icon="shield" label="Nginx" value={nginx.value} color={nginx.color} />
        <StatTile icon="lock" label="SSL" value={ssl.value} color={ssl.color} />
        <StatTile
          icon="activity"
          label="Uptime 24h"
          value={uptimePct != null ? `${uptimePct}%` : '—'}
          color={uptimePct != null && uptimePct < 95 ? 'var(--err)' : undefined}
        />
        {status.redisStatus && <StatTile icon="database" label="Redis" value={redis.value} color={redis.color} />}
        {queue && <StatTile icon="layers" label="Queue" value={queue.value} color={queue.color} mono={false} />}
        {hasNginxErrors && (
          <StatTile icon="alert" label="Nginx Errors" value={`4xx: ${nginx4xx} · 5xx: ${nginx5xx}`} color="var(--err)" mono={false} />
        )}
      </div>

      {/* Mobile: 2-col stat grid */}
      <div className="lg:hidden grid grid-cols-2 gap-4 mb-5">
        <StatTile icon="clock" label="Uptime" value={uptime} mono={false} />
        <StatTile icon="globe" label="Region" value={region} />
        <StatTile icon="hash" label="Build" value={status.buildNumber ?? '—'} />
        <StatTile icon="clock" label="Deployed" value={deployed} mono={false} />
        <StatTile icon="shield" label="Nginx" value={nginx.value} color={nginx.color} />
        <StatTile
          icon="activity"
          label="Uptime 24h"
          value={uptimePct != null ? `${uptimePct}%` : '—'}
          color={uptimePct != null && uptimePct < 95 ? 'var(--err)' : undefined}
        />
        {status.redisStatus && <StatTile icon="database" label="Redis" value={redis.value} color={redis.color} />}
        {queue && <StatTile icon="layers" label="Queue" value={queue.value} color={queue.color} mono={false} />}
        {hasNginxErrors && (
          <StatTile icon="alert" label="Nginx Errors" value={`4xx: ${nginx4xx} · 5xx: ${nginx5xx}`} color="var(--err)" mono={false} />
        )}
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

      {scaleAdvice && (
        <a href="#settings" style={{ textDecoration: 'none' }}>
          <div
            className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--warn)', background: 'transparent' }}
          >
            <span
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border shrink-0"
              style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}
            >
              ↑ {scaleAdvice.nextTier ?? '—'}
              {scaleAdvice.currentEurMonth != null && scaleAdvice.nextEurMonth != null
                ? ` +€${(scaleAdvice.nextEurMonth - scaleAdvice.currentEurMonth).toFixed(0)}/mo`
                : ''}
            </span>
            <span className="text-[11px] font-mono flex-1" style={{ color: 'var(--warn)' }}>
              {scaleAdvice.resource === 'memory' ? 'Memory' : 'Disk'} at {scaleAdvice.sustainedPct}% sustained
              {scaleAdvice.note === 'disk' ? ' — consider also pruning Docker images' : ''}
            </span>
          </div>
        </a>
      )}
    </div>
  )
}
