import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sslDaysLeft, deployedAgo, formatAgo, formatTimestamp, formatTimeLabel } from './date-helpers'

const FIXED_NOW = new Date('2026-07-11T12:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sslDaysLeft', () => {
  it('handles null/undefined input', () => {
    expect(sslDaysLeft(null)).toEqual({ value: '—', days: Infinity })
    expect(sslDaysLeft(undefined)).toEqual({ value: '—', days: Infinity })
  })

  it('handles invalid date string', () => {
    expect(sslDaysLeft('invalid')).toEqual({ value: '—', days: Infinity })
  })

  it('returns Expired with red color for past dates', () => {
    const pastDate = new Date(FIXED_NOW - 86_400_000).toISOString()
    const result = sslDaysLeft(pastDate)
    expect(result.value).toBe('Expired')
    expect(result.color).toBe('var(--err)')
    expect(result.days).toBeLessThan(0)
  })

  it('returns error color for 0-6 days remaining', () => {
    const expiry = new Date(FIXED_NOW + 5 * 86_400_000).toISOString()
    const result = sslDaysLeft(expiry)
    expect(result.value).toBe('5d')
    expect(result.color).toBe('var(--err)')
    expect(result.days).toBe(5)
  })

  it('returns warning color for 7-29 days remaining', () => {
    const expiry = new Date(FIXED_NOW + 15 * 86_400_000).toISOString()
    const result = sslDaysLeft(expiry)
    expect(result.value).toBe('15d')
    expect(result.color).toBe('var(--warn, #e5a00d)')
    expect(result.days).toBe(15)
  })

  it('returns ok color for 30+ days remaining', () => {
    const expiry = new Date(FIXED_NOW + 60 * 86_400_000).toISOString()
    const result = sslDaysLeft(expiry)
    expect(result.value).toBe('60d')
    expect(result.color).toBe('var(--ok, #22c55e)')
    expect(result.days).toBe(60)
  })
})

describe('deployedAgo', () => {
  it('handles null/undefined input', () => {
    expect(deployedAgo(null)).toBe('—')
    expect(deployedAgo(undefined)).toBe('—')
  })

  it('handles invalid epoch', () => {
    expect(deployedAgo('not-a-number')).toBe('—')
  })

  it('handles negative elapsed time', () => {
    const futureEpoch = String(Math.floor((FIXED_NOW + 1000) / 1000))
    expect(deployedAgo(futureEpoch)).toBe('—')
  })

  it('returns "just now" for < 60 seconds', () => {
    const epochSec = Math.floor((FIXED_NOW - 30_000) / 1000)
    expect(deployedAgo(String(epochSec))).toBe('just now')
  })

  it('returns minutes for < 3600 seconds', () => {
    const epochSec = Math.floor((FIXED_NOW - 5 * 60 * 1000) / 1000)
    expect(deployedAgo(String(epochSec))).toBe('5m ago')
  })

  it('returns hours for < 86400 seconds', () => {
    const epochSec = Math.floor((FIXED_NOW - 3 * 3600 * 1000) / 1000)
    expect(deployedAgo(String(epochSec))).toBe('3h ago')
  })

  it('returns days for >= 86400 seconds', () => {
    const epochSec = Math.floor((FIXED_NOW - 7 * 86_400_000) / 1000)
    expect(deployedAgo(String(epochSec))).toBe('7d ago')
  })
})

describe('formatAgo', () => {
  it('returns "just now" for < 1 hour', () => {
    const iso = new Date(FIXED_NOW - 30 * 60 * 1000).toISOString()
    expect(formatAgo(iso)).toBe('just now')
  })

  it('returns hours for 1-23 hours', () => {
    const iso = new Date(FIXED_NOW - 5 * 3600 * 1000).toISOString()
    expect(formatAgo(iso)).toBe('5h ago')
  })

  it('returns days for >= 24 hours', () => {
    const iso = new Date(FIXED_NOW - 3 * 86_400_000).toISOString()
    expect(formatAgo(iso)).toBe('3d ago')
  })
})

describe('formatTimestamp', () => {
  it('formats ISO string to locale format', () => {
    const iso = new Date(FIXED_NOW).toISOString()
    const result = formatTimestamp(iso)
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/)
  })

  it('returns a non-empty string for valid ISO', () => {
    const iso = '2026-07-11T12:30:45Z'
    expect(formatTimestamp(iso).length).toBeGreaterThan(0)
  })
})

describe('formatTimeLabel', () => {
  it('returns HH:MM format for <= 24 hours', () => {
    const result = formatTimeLabel(FIXED_NOW, 24)
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('returns "MMM DD" format for > 24 hours', () => {
    const result = formatTimeLabel(FIXED_NOW, 168)
    expect(result).toMatch(/^[A-Z][a-z]{2} \d+$/)
  })

  it('handles edge case at 24 hour boundary', () => {
    const result24 = formatTimeLabel(FIXED_NOW, 24)
    const result25 = formatTimeLabel(FIXED_NOW, 25)
    expect(result24).toMatch(/^\d{2}:\d{2}$/)
    expect(result25).toMatch(/^[A-Z][a-z]{2} \d+$/)
  })
})
