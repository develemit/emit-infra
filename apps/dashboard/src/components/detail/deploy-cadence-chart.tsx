'use client'
import type { DeployCadenceDay } from '@/lib/api'

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface Props {
  days: DeployCadenceDay[]
}

const W = 800
const H = 80

export function DeployCadenceChart({ days }: Props) {
  if (days.length === 0) return null

  const allZero = days.every(d => d.total === 0)
  if (allZero) {
    return (
      <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
        <div className="text-center py-8">
          <span className="text-[12px] text-subtle">No deploy history in the last 30 days</span>
        </div>
      </div>
    )
  }

  const maxTotal = Math.max(...days.map(d => d.total), 1)
  const barWidth = W / days.length

  return (
    <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[13.5px] font-semibold text-fg">Deploy Cadence</span>
      </div>

      <div style={{ height: H + 20 }}>
        <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" height="100%" preserveAspectRatio="none">
          {days.map((day, idx) => {
            const x = idx * barWidth
            const successHeight = (day.total - day.failures) / maxTotal * H
            const failureHeight = day.failures / maxTotal * H

            return (
              <g key={day.date}>
                {day.total > 0 && (
                  <>
                    {successHeight > 0 && (
                      <rect
                        x={x + 1}
                        y={H - successHeight}
                        width={barWidth - 2}
                        height={successHeight}
                        fill="var(--accent)"
                      />
                    )}
                    {failureHeight > 0 && (
                      <rect
                        x={x + 1}
                        y={H - successHeight - failureHeight}
                        width={barWidth - 2}
                        height={failureHeight}
                        fill="var(--err)"
                      />
                    )}
                  </>
                )}
                {idx % 7 === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={H + 14}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--fg)"
                    fontFamily="monospace"
                  >
                    {fmtDate(day.date)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
