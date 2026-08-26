import type { MetricPoint } from './metric-point.js'

export interface LinearTrend {
  current: number
  pctPerDay: number
  projectedDaysUntilFull: number | null
}

// Ordinary least-squares slope of `key` over time, extrapolated to %/day and
// (if rising) days until the metric would hit 100%. Shared by disk-trend and
// memory-trend, which differ only in which MetricPoint field they track.
export function computeLinearTrend(points: MetricPoint[], key: 'disk' | 'mem'): LinearTrend {
  const current = points[points.length - 1]?.[key] ?? 0
  if (points.length < 5) return { current, pctPerDay: 0, projectedDaysUntilFull: null }

  const n = points.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (const p of points) {
    const y = p[key]
    sumX += p.t
    sumY += y
    sumXY += p.t * y
    sumX2 += p.t * p.t
  }
  const denom = n * sumX2 - sumX * sumX
  const slopePerSec = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  const pctPerDay = slopePerSec * 86400

  const projectedDaysUntilFull = pctPerDay <= 0 ? null : (100 - current) / pctPerDay

  return { current, pctPerDay, projectedDaysUntilFull }
}
