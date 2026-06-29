import { describe, it, expect } from 'vitest'
import {
  toPolyline, deployX, formatTimeLabel, formatTooltipTime,
  timeLabels, filterVisibleDeploys,
} from './full-chart-helpers'

const t0 = 1_000_000_000 * 1000 // fixed epoch for determinism
const tEnd = t0 + 24 * 3600 * 1000

function makePoints(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    t: t0 + (i / (count - 1)) * (tEnd - t0),
    cpu: i * 5,
    mem: 20 + i * 2,
    disk: 50 + i,
  }))
}

describe('toPolyline', () => {
  it('returns empty string for fewer than 2 points', () => {
    expect(toPolyline([], 'cpu')).toBe('')
    expect(toPolyline([{ t: t0, cpu: 10, mem: 20, disk: 30 }], 'mem')).toBe('')
  })

  it('returns space-separated x,y pairs for 2+ points', () => {
    const points = makePoints(2)
    const result = toPolyline(points, 'disk')
    const pairs = result.trim().split(' ')
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/)
  })

  it('first point maps to x=0, last to x=800', () => {
    const points = makePoints(3)
    const result = toPolyline(points, 'mem')
    const pairs = result.trim().split(' ')
    expect(parseFloat(pairs[0]!.split(',')[0]!)).toBeCloseTo(0, 1)
    expect(parseFloat(pairs[2]!.split(',')[0]!)).toBeCloseTo(800, 1)
  })
})

describe('deployX', () => {
  it('returns 0 for a deploy at t0', () => {
    const span = tEnd - t0
    expect(deployX(new Date(t0).toISOString(), t0, span)).toBeCloseTo(0, 1)
  })

  it('returns 800 for a deploy at tEnd', () => {
    const span = tEnd - t0
    expect(deployX(new Date(tEnd).toISOString(), t0, span)).toBeCloseTo(800, 1)
  })
})

describe('formatTimeLabel', () => {
  it('returns HH:MM for 24h window', () => {
    const result = formatTimeLabel(t0, 24)
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('returns "MMM DD" format for 168h window', () => {
    const result = formatTimeLabel(t0, 168)
    expect(result).toMatch(/^[A-Z][a-z]+ \d+$/)
  })
})

describe('formatTooltipTime', () => {
  it('returns a non-empty string', () => {
    expect(formatTooltipTime(t0).length).toBeGreaterThan(0)
  })
})

describe('timeLabels', () => {
  it('returns empty array for fewer than 2 points', () => {
    expect(timeLabels([], 24)).toHaveLength(0)
    expect(timeLabels([{ t: t0, cpu: 0, mem: 0, disk: 0 }], 24)).toHaveLength(0)
  })

  it('returns 7 labels for 24h window', () => {
    const pts = makePoints(10)
    const labels = timeLabels(pts, 24)
    expect(labels).toHaveLength(7) // 0..6 inclusive
    expect(labels[0]!.x).toBeCloseTo(0, 0)
    expect(labels[6]!.x).toBeCloseTo(800, 0)
  })
})

describe('filterVisibleDeploys', () => {
  it('returns empty array when no deploys', () => {
    expect(filterVisibleDeploys([], t0, tEnd - t0)).toHaveLength(0)
  })

  it('filters deploys outside the time range', () => {
    const span = tEnd - t0
    const deploys = [
      { completedAt: new Date(t0 - 1000).toISOString(), sha: 'aaa', status: 'success' as const },
      { completedAt: new Date(t0 + span / 2).toISOString(), sha: 'bbb', status: 'success' as const },
      { completedAt: new Date(tEnd + 1000).toISOString(), sha: 'ccc', status: 'success' as const },
    ]
    const result = filterVisibleDeploys(deploys, t0, span)
    expect(result).toHaveLength(1)
    expect(result[0]!.sha).toBe('bbb')
  })
})
