import { describe, it, expect } from 'vitest'
import {
  timeToX, incidentBar, deployX, fleetTimeLabels, fmtDuration,
  CHART_W,
} from './fleet-timeline-helpers'

const NOW_SEC = 1_750_000_000
const DAY = 86400

describe('timeToX', () => {
  it('maps tMin to 0', () => {
    expect(timeToX(NOW_SEC, NOW_SEC, NOW_SEC + DAY)).toBeCloseTo(0)
  })

  it('maps tMax to CHART_W', () => {
    expect(timeToX(NOW_SEC + DAY, NOW_SEC, NOW_SEC + DAY)).toBeCloseTo(CHART_W)
  })

  it('maps midpoint to CHART_W / 2', () => {
    expect(timeToX(NOW_SEC + DAY / 2, NOW_SEC, NOW_SEC + DAY)).toBeCloseTo(CHART_W / 2)
  })

  it('handles zero-span gracefully', () => {
    const x = timeToX(NOW_SEC, NOW_SEC, NOW_SEC)
    expect(isNaN(x)).toBe(false)
  })
})

describe('incidentBar', () => {
  const tMin = NOW_SEC
  const tMax = NOW_SEC + DAY

  it('resolved incident fully in range produces valid rect', () => {
    const { x, width } = incidentBar(NOW_SEC + 3600, NOW_SEC + 7200, tMin, tMax)
    expect(x).toBeGreaterThan(0)
    expect(width).toBeGreaterThan(0)
    expect(x + width).toBeLessThanOrEqual(CHART_W + 0.1)
  })

  it('unresolved incident extends to right edge', () => {
    const { x, width } = incidentBar(NOW_SEC + 3600, null, tMin, tMax)
    expect(x).toBeGreaterThan(0)
    expect(x + width).toBeCloseTo(CHART_W, 0)
  })

  it('incident starting before tMin clamps to x=0', () => {
    const { x } = incidentBar(NOW_SEC - 3600, NOW_SEC + 3600, tMin, tMax)
    expect(x).toBeCloseTo(0)
  })

  it('minimum width is 2px', () => {
    // zero-duration incident (started == resolved)
    const { width } = incidentBar(NOW_SEC + 3600, NOW_SEC + 3600, tMin, tMax)
    expect(width).toBeGreaterThanOrEqual(2)
  })
})

describe('deployX', () => {
  it('returns 0 for deploy at tMin', () => {
    const iso = new Date(NOW_SEC * 1000).toISOString()
    expect(deployX(iso, NOW_SEC, NOW_SEC + DAY)).toBeCloseTo(0)
  })

  it('returns CHART_W for deploy at tMax', () => {
    const iso = new Date((NOW_SEC + DAY) * 1000).toISOString()
    expect(deployX(iso, NOW_SEC, NOW_SEC + DAY)).toBeCloseTo(CHART_W)
  })
})

describe('fleetTimeLabels', () => {
  it('returns 8 labels for 7-day range (0..7)', () => {
    const labels = fleetTimeLabels(NOW_SEC, NOW_SEC + 7 * DAY, 7)
    expect(labels).toHaveLength(8)
    expect(labels[0]!.x).toBeCloseTo(0)
    expect(labels[7]!.x).toBeCloseTo(CHART_W)
  })

  it('returns 7 labels for 1-day range (0..6)', () => {
    const labels = fleetTimeLabels(NOW_SEC, NOW_SEC + DAY, 1)
    expect(labels).toHaveLength(7)
  })

  it('1-day labels look like HH:MM', () => {
    const labels = fleetTimeLabels(NOW_SEC, NOW_SEC + DAY, 1)
    expect(labels[0]!.label).toMatch(/^\d{2}:\d{2}$/)
  })

  it('7-day labels look like "MMM D"', () => {
    const labels = fleetTimeLabels(NOW_SEC, NOW_SEC + 7 * DAY, 7)
    expect(labels[0]!.label).toMatch(/^[A-Z][a-z]+ \d+$/)
  })
})

describe('fmtDuration', () => {
  it('null → ongoing', () => { expect(fmtDuration(null)).toBe('ongoing') })
  it('< 60s → seconds', () => { expect(fmtDuration(45)).toBe('45s') })
  it('minutes', () => { expect(fmtDuration(150)).toBe('2m') })
  it('hours', () => { expect(fmtDuration(3700)).toBe('1h 1m') })
})
