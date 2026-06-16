'use client'
import { Icon } from '@/components/icon'
import type { MetricPoint } from '@/lib/metric-history'

interface Props {
  name: string
  history: MetricPoint[]
  uptimePct: number | null
}

// SVG plot dimensions (no internal margin — layout div handles spacing)
const W = 368
const H = 54

function toPoints(history: MetricPoint[], key: 'mem' | 'disk'): string {
  const t0 = history[0].t
  const span = (history[history.length - 1].t - t0) || 1
  return history
    .map(p => `${((p.t - t0) / span * W).toFixed(1)},${((1 - p[key] / 100) * H).toFixed(1)}`)
    .join(' ')
}

function formatAge(ms: number): string {
  const d = Date.now() - ms
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`
  return `${(d / 3_600_000).toFixed(1)}h ago`
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
      <span style={{ display: 'inline-block', width: 16, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  )
}

export function ResourceChart({ name, history, uptimePct }: Props) {
  const hasData = history.length >= 2
  const gradId = `mf-${name.replace(/\W/g, '-')}`

  const memLine = hasData ? toPoints(history, 'mem') : ''
  const diskLine = hasData ? toPoints(history, 'disk') : ''
  const memFill = hasData
    ? `0,${H} ${memLine} ${W},${H}`
    : ''
  const y80 = ((1 - 0.8) * H).toFixed(1)

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Icon name="activity" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Resource History</span>
        <div className="flex-1" />
        {hasData && (
          <div className="flex items-center gap-3 mr-2">
            <LegendLine color="var(--accent)" label="mem" />
            <LegendLine color="var(--fg-faint)" label="disk" />
          </div>
        )}
        {uptimePct != null && (
          <span
            className="text-[10px] font-mono rounded-full px-2 py-0.5"
            style={{ background: 'var(--card-2)', border: '1px solid var(--border)', color: 'var(--subtle)' }}
          >
            {uptimePct}% up
          </span>
        )}
        <span
          className="text-[10px] font-mono text-subtle rounded-full px-2 py-0.5"
          style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}
        >
          24h
        </span>
      </div>

      {/* Empty state */}
      {!hasData ? (
        <div
          className="flex items-center justify-center text-[12px] font-mono text-subtle rounded-lg"
          style={{ height: 64, background: 'var(--card-2)', border: '1px solid var(--border)' }}
        >
          collecting data…
        </div>
      ) : (
        <div className="relative" style={{ paddingLeft: 32, paddingBottom: 16 }}>
          {/* Y-axis labels — absolutely positioned so they align with SVG plot */}
          <div className="absolute left-0" style={{ top: 0, bottom: 16, width: 28 }}>
            <span className="absolute right-0 top-0 text-[9px] font-mono text-subtle leading-none">100</span>
            <span
              className="absolute right-0 text-[9px] font-mono leading-none"
              style={{ top: '20%', transform: 'translateY(-50%)', color: 'var(--err)', opacity: 0.55 }}
            >80</span>
            <span className="absolute right-0 bottom-0 text-[9px] font-mono text-subtle leading-none">0</span>
          </div>

          {/* SVG — preserveAspectRatio="none" stretches lines to fill; no text inside */}
          <div style={{ height: 64 }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height="100%"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* 80% threshold dashed line */}
              <line
                x1={0} x2={W} y1={y80} y2={y80}
                stroke="var(--err)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.45"
              />
              {/* Disk line (subtle) */}
              <polyline
                points={diskLine}
                fill="none" stroke="var(--fg-faint)" strokeWidth="1.2" opacity="0.45"
                strokeLinejoin="round" strokeLinecap="round"
              />
              {/* Memory gradient fill */}
              <polygon points={memFill} fill={`url(#${gradId})`} />
              {/* Memory line */}
              <polyline
                points={memLine}
                fill="none" stroke="var(--accent)" strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round"
              />
            </svg>
          </div>

          {/* X-axis labels */}
          <div className="flex justify-between mt-1">
            <span className="text-[9px] font-mono text-subtle">{formatAge(history[0].t)}</span>
            <span className="text-[9px] font-mono text-subtle">now</span>
          </div>
        </div>
      )}
    </div>
  )
}
