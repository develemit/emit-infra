import { describe, it, expect } from 'vitest'
import { computeLinearTrend } from './trend.js'
import type { MetricPoint } from './metric-point.js'

function point(t: number, disk: number): MetricPoint {
  return {
    t, cpu: 0, mem: 0, memUsedMb: 0, memTotalMb: 0, disk,
    diskUsedGb: '0', diskTotalGb: '0', netRxBytes: 0, netTxBytes: 0,
    containers: [],
  }
}

describe('computeLinearTrend', () => {
  it('returns zero trend and null projection with fewer than 5 points', () => {
    const points = [point(0, 50), point(1, 51)]
    expect(computeLinearTrend(points, 'disk')).toEqual({ current: 51, pctPerDay: 0, projectedDaysUntilFull: null })
  })

  it('returns current 0 for an empty series', () => {
    expect(computeLinearTrend([], 'disk')).toEqual({ current: 0, pctPerDay: 0, projectedDaysUntilFull: null })
  })

  it('projects days until full for a rising trend', () => {
    const points = Array.from({ length: 5 }, (_, i) => point(i * 86400, 50 + i * 5))
    const trend = computeLinearTrend(points, 'disk')
    expect(trend.current).toBe(70)
    expect(trend.pctPerDay).toBeCloseTo(5, 5)
    expect(trend.projectedDaysUntilFull).toBeCloseTo(6, 5)
  })

  it('returns null projection for a flat or falling trend', () => {
    const points = Array.from({ length: 5 }, (_, i) => point(i * 86400, 50 - i))
    const trend = computeLinearTrend(points, 'disk')
    expect(trend.projectedDaysUntilFull).toBeNull()
  })

  it('tracks the mem key independently of disk', () => {
    const points = Array.from({ length: 5 }, (_, i) => ({ ...point(i * 86400, 0), mem: 40 + i * 2 }))
    const trend = computeLinearTrend(points, 'mem')
    expect(trend.current).toBe(48)
  })
})
