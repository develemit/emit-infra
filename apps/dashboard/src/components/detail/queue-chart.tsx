'use client'
import type { MetricPoint } from '@/lib/api'

interface Props {
  points: MetricPoint[]
}

const W = 800
const H = 60

function toPolyline(
  points: MetricPoint[],
  key: 'queueFailed' | 'queueWait',
): string {
  if (points.length < 2) return ''
  const values = points.map(p => p[key] ?? 0)
  const maxVal = Math.max(...values, 1)

  const t0 = points[0]!.t
  const span = (points[points.length - 1]!.t - t0) || 1

  return points
    .map((p) => {
      const x = ((p.t - t0) / span) * W
      const val = p[key] ?? 0
      const y = (1 - val / maxVal) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function QueueChart({ points }: Props) {
  const hasData = points.length >= 2
  const hasFailed = hasData && points.some(p => p.queueFailed != null && p.queueFailed > 0)
  const hasWait = hasData && points.some(p => p.queueWait != null && p.queueWait > 0)

  if (!hasData || (!hasFailed && !hasWait)) return null

  const failedLine = toPolyline(points, 'queueFailed')
  const waitLine = toPolyline(points, 'queueWait')

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[13.5px] font-semibold text-fg">Queue Depth</span>
        <div className="flex-1" />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
            <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--err)', borderRadius: 2 }} />
            failed
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-subtle">
            <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--fg-muted)', borderRadius: 2 }} />
            waiting
          </div>
        </div>
      </div>

      <div style={{ height: H + 2 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {failedLine && (
            <polyline
              points={failedLine}
              fill="none"
              stroke="var(--err)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {waitLine && (
            <polyline
              points={waitLine}
              fill="none"
              stroke="var(--fg-muted)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
    </div>
  )
}
