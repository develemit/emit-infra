'use client'
import type { FleetProjectData } from '@/lib/api-history'
import {
  incidentBar, deployX, fleetTimeLabels, fmtDuration,
  CHART_W, LABEL_W, LANE_H, AXIS_H,
} from '@/lib/fleet-timeline-helpers'

interface Props {
  data: FleetProjectData[]
  days: number
}

export function FleetIncidentTimeline({ data, days }: Props) {
  const nowSec = Math.floor(Date.now() / 1000)
  const tMin = nowSec - days * 86400
  const tMax = nowSec

  const totalW = LABEL_W + CHART_W
  const totalH = data.length * LANE_H + AXIS_H
  const labels = fleetTimeLabels(tMin, tMax, days)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-subtle text-[12px] font-mono">
        No incidents or deploys in this range
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        width={totalW}
        height={totalH}
        style={{ display: 'block', minWidth: totalW }}
      >
        {/* Lane stripes */}
        {data.map((_, i) => (
          <rect
            key={i}
            x={0}
            y={i * LANE_H}
            width={totalW}
            height={LANE_H}
            fill={i % 2 === 0 ? 'var(--card)' : 'var(--elev)'}
          />
        ))}

        {/* Project name labels */}
        {data.map((d, i) => (
          <text
            key={d.project}
            x={LABEL_W - 6}
            y={i * LANE_H + LANE_H / 2 + 4}
            textAnchor="end"
            fontSize="10"
            fontFamily="monospace"
            fill="var(--fg)"
          >
            {d.project.length > 13 ? d.project.slice(0, 12) + '…' : d.project}
          </text>
        ))}

        {/* Incident bars */}
        {data.map((d, i) =>
          d.incidents.map((inc, j) => {
            const { x, width } = incidentBar(inc.startedAt, inc.resolvedAt, tMin, tMax)
            const laneY = i * LANE_H + 4
            const note = [
              inc.note,
              `Start: ${new Date(inc.startedAt * 1000).toLocaleString()}`,
              `Duration: ${fmtDuration(inc.durationSec)}`,
              inc.falsePositive ? 'false positive' : null,
            ].filter(Boolean).join('\n')
            return (
              <rect
                key={`inc-${j}`}
                x={LABEL_W + x}
                y={laneY}
                width={width}
                height={LANE_H - 8}
                rx={2}
                fill="var(--err)"
                opacity={inc.falsePositive ? 0.25 : 0.85}
              >
                <title>{note}</title>
              </rect>
            )
          })
        )}

        {/* Deploy ticks */}
        {data.map((d, i) =>
          d.deploys.map((dep, j) => {
            const x = deployX(dep.completedAt, tMin, tMax)
            if (x < 0 || x > CHART_W) return null
            const laneY = i * LANE_H
            return (
              <line
                key={`dep-${j}`}
                x1={LABEL_W + x}
                y1={laneY + 2}
                x2={LABEL_W + x}
                y2={laneY + LANE_H - 2}
                stroke={dep.status === 'success' ? 'var(--accent)' : 'var(--warn)'}
                strokeWidth={1.5}
                opacity={0.7}
              >
                <title>{`Deploy ${dep.sha.slice(0, 7)} — ${dep.status}\n${new Date(dep.completedAt).toLocaleString()}`}</title>
              </line>
            )
          })
        )}

        {/* Grid lines + time axis */}
        {labels.map((l, i) => (
          <g key={i}>
            <line
              x1={LABEL_W + l.x}
              y1={0}
              x2={LABEL_W + l.x}
              y2={data.length * LANE_H}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
            <text
              x={LABEL_W + l.x}
              y={data.length * LANE_H + 16}
              textAnchor="middle"
              fontSize="9"
              fontFamily="monospace"
              fill="var(--subtle)"
            >
              {l.label}
            </text>
          </g>
        ))}

        {/* Left edge line separating labels from chart */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={totalH} stroke="var(--border)" strokeWidth={1} />
      </svg>
    </div>
  )
}
