'use client'
import { useState } from 'react'
import type { DeployMarker } from './resource-chart'
import { toPolyline, deployX, formatTimeLabel, formatTooltipTime, timeLabels, filterVisibleDeploys, getChartDimensions, type HoverState } from './full-chart-helpers'

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

const { W, H } = getChartDimensions()

function LegendItem({ color, vertical, label }: { color: string; vertical?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
      <span style={{
        display: 'inline-block',
        width: vertical ? 1 : 14,
        height: vertical ? 10 : 2,
        background: color,
        borderRadius: 1,
        opacity: 0.8,
      }} />
      {label}
    </span>
  )
}

export function FullChart({ points, deploys, hours }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null)

  const hasData = points.length >= 2
  const hasCpu = hasData && points.some(p => p.cpu > 0)
  const gradId = 'fc-mem-grad'

  const t0 = hasData ? points[0]!.t : 0
  const span = hasData ? (points[points.length - 1]!.t - t0) || 1 : 1

  const cpuLine = hasCpu ? toPolyline(points, 'cpu') : ''
  const memLine = hasData ? toPolyline(points, 'mem') : ''
  const diskLine = hasData ? toPolyline(points, 'disk') : ''
  const memFill = hasData ? `0,${H} ${memLine} ${W},${H}` : ''
  const y80 = ((1 - 0.8) * H).toFixed(1)

  const visibleDeploys = filterVisibleDeploys(deploys ?? [], t0, span)

  const xLabels = hasData ? timeLabels(points, hours) : []

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const targetT = t0 + pct * span
    let closest = points[0]!
    let minDiff = Math.abs(closest.t - targetT)
    for (const p of points) {
      const diff = Math.abs(p.t - targetT)
      if (diff < minDiff) { minDiff = diff; closest = p }
    }
    let nearestDeploy: DeployMarker | null = null
    let minDeployDist = 0.04
    for (const d of visibleDeploys) {
      const dPct = (new Date(d.completedAt).getTime() - t0) / span
      const dist = Math.abs(dPct - pct)
      if (dist < minDeployDist) { minDeployDist = dist; nearestDeploy = d }
    }
    setHover({ pct, point: closest, deploy: nearestDeploy })
  }

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[13.5px] font-semibold text-fg">Resource Usage</span>
        <div className="flex-1" />
        {hasData && (
          <div className="flex items-center gap-3 flex-wrap">
            {hasCpu && <LegendItem color="#f59e0b" label="CPU %" />}
            <LegendItem color="var(--accent)" label="Memory %" />
            <LegendItem color="var(--fg-faint)" label="Disk %" />
            {visibleDeploys.length > 0 && <LegendItem color="#22d3ee" vertical label="Deploy" />}
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
        <div className="relative" style={{ paddingLeft: 36, paddingBottom: 20 }}>
          <div className="absolute left-0" style={{ top: 0, bottom: 20, width: 32 }}>
            <span className="absolute right-1 top-0 text-[9px] font-mono text-subtle leading-none">100%</span>
            <span className="absolute right-1 text-[9px] font-mono text-subtle leading-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>50%</span>
            <span className="absolute right-1 bottom-0 text-[9px] font-mono text-subtle leading-none">0%</span>
          </div>

          <div
            className="relative"
            style={{ height: 200, cursor: 'crosshair' }}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            {hover && (
              <div
                className="absolute z-10 pointer-events-none"
                style={{
                  top: 6,
                  left: `${Math.min(Math.max(hover.pct * 100, 8), 72)}%`,
                  transform: 'translateX(-50%)',
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  minWidth: 118,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                }}
              >
                <div className="text-[9px] font-mono text-subtle mb-1.5">
                  {formatTooltipTime(hover.point.t)}
                </div>
                {hasCpu && (
                  <div className="flex justify-between gap-3 text-[10px] font-mono">
                    <span style={{ color: '#f59e0b' }}>CPU</span>
                    <span className="text-fg">{hover.point.cpu.toFixed(1)}%</span>
                  </div>
                )}
                <div className="flex justify-between gap-3 text-[10px] font-mono">
                  <span style={{ color: 'var(--accent)' }}>Mem</span>
                  <span className="text-fg">{hover.point.mem.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between gap-3 text-[10px] font-mono">
                  <span className="text-subtle">Disk</span>
                  <span className="text-fg">{hover.point.disk.toFixed(1)}%</span>
                </div>
                {hover.deploy && (
                  <div className="mt-1.5 pt-1.5 border-t border-border text-[9px] font-mono" style={{ color: '#22d3ee' }}>
                    deploy {hover.deploy.sha?.slice(0, 7) ?? ''}
                  </div>
                )}
              </div>
            )}

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1={0} x2={W} y1={y80} y2={y80} stroke="var(--err)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.4" />
              <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeWidth="0.3" opacity="0.5" />
              {visibleDeploys.map((d, i) => {
                const x = deployX(d.completedAt, t0, span)
                return (
                  <g key={i}>
                    <line x1={x} x2={x} y1={0} y2={H} stroke="#22d3ee" strokeWidth="0.8" opacity="0.6" strokeDasharray="2 2" />
                    <circle cx={x} cy={3} r={2} fill="#22d3ee" opacity="0.8" />
                  </g>
                )
              })}
              <polyline points={diskLine} fill="none" stroke="var(--fg-faint)" strokeWidth="1" opacity="0.45" strokeLinejoin="round" strokeLinecap="round" />
              {cpuLine && (
                <polyline points={cpuLine} fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity="0.7" strokeLinejoin="round" strokeLinecap="round" />
              )}
              <polygon points={memFill} fill={`url(#${gradId})`} />
              <polyline points={memLine} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
              {hover && (
                <line x1={hover.pct * W} x2={hover.pct * W} y1={0} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
              )}
            </svg>
          </div>

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
