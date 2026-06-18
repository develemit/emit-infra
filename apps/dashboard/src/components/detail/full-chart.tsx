'use client'
import type { DeployMarker } from './resource-chart'

export interface FullChartPoint {
  t: number
  cpu: number
  mem: number
  disk: number
}

interface Props {
  points: FullChartPoint[]
  deploys?: DeployMarker[]
  hours: number
}

const W = 800
const H = 200

function toPolyline(points: FullChartPoint[], key: 'cpu' | 'mem' | 'disk'): string {
  if (points.length < 2) return ''
  const t0 = points[0]!.t
  const span = (points[points.length - 1]!.t - t0) || 1
  return points
    .map(p => {
      const x = ((p.t - t0) / span) * W
      const y = (1 - p[key] / 100) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function deployX(completedAt: string, t0: number, span: number): number {
  const ts = new Date(completedAt).getTime()
  return ((ts - t0) / span) * W
}

function formatTimeLabel(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function timeLabels(points: FullChartPoint[], hours: number): { x: number; label: string }[] {
  if (points.length < 2) return []
  const t0 = points[0]!.t
  const tEnd = points[points.length - 1]!.t
  const span = tEnd - t0 || 1
  const count = hours <= 24 ? 6 : hours <= 168 ? 7 : 6
  const labels: { x: number; label: string }[] = []
  for (let i = 0; i <= count; i++) {
    const t = t0 + (span * i) / count
    labels.push({ x: ((t - t0) / span) * W, label: formatTimeLabel(t, hours) })
  }
  return labels
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
      <span style={{ display: 'inline-block', width: 16, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  )
}

export function FullChart({ points, deploys, hours }: Props) {
  const hasData = points.length >= 2
  const hasCpu = hasData && points.some(p => p.cpu > 0)
  const gradId = 'fc-mem-grad'

  const cpuLine = hasCpu ? toPolyline(points, 'cpu') : ''
  const memLine = hasData ? toPolyline(points, 'mem') : ''
  const diskLine = hasData ? toPolyline(points, 'disk') : ''
  const memFill = hasData ? `0,${H} ${memLine} ${W},${H}` : ''
  const y80 = ((1 - 0.8) * H).toFixed(1)

  const t0 = hasData ? points[0]!.t : 0
  const span = hasData ? (points[points.length - 1]!.t - t0) || 1 : 1

  const visibleDeploys = (deploys ?? []).filter(d => {
    const ts = new Date(d.completedAt).getTime()
    return ts >= t0 && ts <= t0 + span
  })

  const xLabels = hasData ? timeLabels(points, hours) : []

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[13.5px] font-semibold text-fg">Resource Usage</span>
        <div className="flex-1" />
        {hasData && (
          <div className="flex items-center gap-3 flex-wrap">
            {hasCpu && <LegendLine color="#f59e0b" label="cpu" />}
            <LegendLine color="var(--accent)" label="mem" />
            <LegendLine color="var(--fg-faint)" label="disk" />
            {visibleDeploys.length > 0 && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
                <span style={{ display: 'inline-block', width: 1, height: 10, background: '#22d3ee', borderRadius: 1 }} />
                deploy
              </span>
            )}
          </div>
        )}
      </div>

      {!hasData ? (
        <div
          className="flex items-center justify-center text-[12px] font-mono text-subtle rounded-lg"
          style={{ height: 200, background: 'var(--card-2)', border: '1px solid var(--border)' }}
        >
          collecting data...
        </div>
      ) : (
        <div className="relative" style={{ paddingLeft: 32, paddingBottom: 24 }}>
          {/* Y-axis labels */}
          <div className="absolute left-0" style={{ top: 0, bottom: 24, width: 28 }}>
            <span className="absolute right-0 top-0 text-[9px] font-mono text-subtle leading-none">100%</span>
            <span className="absolute right-0 text-[9px] font-mono text-subtle leading-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>50%</span>
            <span className="absolute right-0 bottom-0 text-[9px] font-mono text-subtle leading-none">0%</span>
          </div>

          {/* SVG chart */}
          <div style={{ height: 200 }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* 80% threshold */}
              <line x1={0} x2={W} y1={y80} y2={y80} stroke="var(--err)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.4" />
              {/* 50% gridline */}
              <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeWidth="0.3" opacity="0.5" />
              {/* Deploy markers */}
              {visibleDeploys.map((d, i) => {
                const x = deployX(d.completedAt, t0, span)
                return (
                  <g key={i}>
                    <line x1={x} x2={x} y1={0} y2={H} stroke="#22d3ee" strokeWidth="0.8" opacity="0.6" strokeDasharray="2 2" />
                    <circle cx={x} cy={3} r={2} fill="#22d3ee" opacity="0.8" />
                    {d.sha && (
                      <title>{`Deploy ${d.sha.slice(0, 7)} — ${d.completedAt}`}</title>
                    )}
                  </g>
                )
              })}
              {/* Disk */}
              <polyline points={diskLine} fill="none" stroke="var(--fg-faint)" strokeWidth="1" opacity="0.45" strokeLinejoin="round" strokeLinecap="round" />
              {/* CPU */}
              {cpuLine && (
                <polyline points={cpuLine} fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity="0.7" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {/* Memory fill + line */}
              <polygon points={memFill} fill={`url(#${gradId})`} />
              <polyline points={memLine} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>

          {/* X-axis time labels */}
          <div className="relative" style={{ height: 16 }}>
            {xLabels.map((lbl, i) => (
              <span
                key={i}
                className="absolute text-[9px] font-mono text-subtle"
                style={{ left: `${(lbl.x / W) * 100}%`, transform: 'translateX(-50%)', top: 4 }}
              >
                {lbl.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
