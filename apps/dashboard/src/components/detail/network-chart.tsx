'use client'
import type { DeployMarker } from './resource-chart'

interface NetworkPoint {
  t: number
  netRxBytes: number
  netTxBytes: number
}

interface BandwidthPoint {
  t: number
  rxRate: number
  txRate: number
}

interface Props {
  points: NetworkPoint[]
  deploys?: DeployMarker[]
  hours: number
}

const W = 800
const H = 160

function computeBandwidth(points: NetworkPoint[]): BandwidthPoint[] {
  if (points.length < 2) return []
  const result: BandwidthPoint[] = []
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i]!.t - points[i - 1]!.t) / 1000
    if (dt <= 0) continue
    const rxDelta = Math.max(0, points[i]!.netRxBytes - points[i - 1]!.netRxBytes)
    const txDelta = Math.max(0, points[i]!.netTxBytes - points[i - 1]!.netTxBytes)
    result.push({ t: points[i]!.t, rxRate: rxDelta / dt, txRate: txDelta / dt })
  }
  return result
}

function formatBandwidth(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

function toArea(bw: BandwidthPoint[], key: 'rxRate' | 'txRate', maxVal: number): string {
  if (bw.length < 2) return ''
  const t0 = bw[0]!.t
  const span = (bw[bw.length - 1]!.t - t0) || 1
  const pts = bw
    .map(p => {
      const x = ((p.t - t0) / span) * W
      const y = (1 - p[key] / maxVal) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return `0,${H} ${pts} ${W},${H}`
}

function toLine(bw: BandwidthPoint[], key: 'rxRate' | 'txRate', maxVal: number): string {
  if (bw.length < 2) return ''
  const t0 = bw[0]!.t
  const span = (bw[bw.length - 1]!.t - t0) || 1
  return bw
    .map(p => {
      const x = ((p.t - t0) / span) * W
      const y = (1 - p[key] / maxVal) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function deployXPos(completedAt: string, t0: number, span: number): number {
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

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
      <span style={{ display: 'inline-block', width: 16, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </span>
  )
}

export function NetworkChart({ points, deploys, hours }: Props) {
  const bw = computeBandwidth(points)
  const hasData = bw.length >= 2
  const maxVal = hasData ? Math.max(1, ...bw.map(b => Math.max(b.rxRate, b.txRate))) * 1.1 : 1

  const t0 = hasData ? bw[0]!.t : 0
  const tEnd = hasData ? bw[bw.length - 1]!.t : 1
  const span = (tEnd - t0) || 1

  const visibleDeploys = (deploys ?? []).filter(d => {
    const ts = new Date(d.completedAt).getTime()
    return ts >= t0 && ts <= t0 + span
  })

  const xLabelCount = hours <= 24 ? 6 : hours <= 168 ? 7 : 6
  const xLabels = hasData
    ? Array.from({ length: xLabelCount + 1 }, (_, i) => {
        const t = t0 + (span * i) / xLabelCount
        return { x: ((t - t0) / span) * W, label: formatTimeLabel(t, hours) }
      })
    : []

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[13.5px] font-semibold text-fg">Network Bandwidth</span>
        <div className="flex-1" />
        {hasData && (
          <div className="flex items-center gap-3 flex-wrap">
            <LegendLine color="#34d399" label="rx" />
            <LegendLine color="#818cf8" label="tx" />
            <span className="text-[9px] font-mono text-subtle">peak: {formatBandwidth(maxVal / 1.1)}</span>
          </div>
        )}
      </div>

      {!hasData ? (
        <div
          className="flex items-center justify-center text-[12px] font-mono text-subtle rounded-lg"
          style={{ height: 160, background: 'var(--card-2)', border: '1px solid var(--border)' }}
        >
          collecting data...
        </div>
      ) : (
        <div className="relative" style={{ paddingLeft: 48, paddingBottom: 24 }}>
          {/* Y-axis labels */}
          <div className="absolute left-0" style={{ top: 0, bottom: 24, width: 44 }}>
            <span className="absolute right-0 top-0 text-[9px] font-mono text-subtle leading-none">{formatBandwidth(maxVal / 1.1)}</span>
            <span className="absolute right-0 text-[9px] font-mono text-subtle leading-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>{formatBandwidth(maxVal / 1.1 / 2)}</span>
            <span className="absolute right-0 bottom-0 text-[9px] font-mono text-subtle leading-none">0</span>
          </div>

          <div style={{ height: 160 }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="nc-rx-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="nc-tx-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* 50% gridline */}
              <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeWidth="0.3" opacity="0.5" />
              {/* Deploy markers */}
              {visibleDeploys.map((d, i) => {
                const x = deployXPos(d.completedAt, t0, span)
                return (
                  <g key={i}>
                    <line x1={x} x2={x} y1={0} y2={H} stroke="#22d3ee" strokeWidth="0.8" opacity="0.6" strokeDasharray="2 2" />
                    <circle cx={x} cy={3} r={2} fill="#22d3ee" opacity="0.8" />
                  </g>
                )
              })}
              {/* RX area + line */}
              <polygon points={toArea(bw, 'rxRate', maxVal)} fill="url(#nc-rx-grad)" />
              <polyline points={toLine(bw, 'rxRate', maxVal)} fill="none" stroke="#34d399" strokeWidth="1.2" opacity="0.8" strokeLinejoin="round" strokeLinecap="round" />
              {/* TX area + line */}
              <polygon points={toArea(bw, 'txRate', maxVal)} fill="url(#nc-tx-grad)" />
              <polyline points={toLine(bw, 'txRate', maxVal)} fill="none" stroke="#818cf8" strokeWidth="1.2" opacity="0.8" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>

          {/* X-axis labels */}
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
