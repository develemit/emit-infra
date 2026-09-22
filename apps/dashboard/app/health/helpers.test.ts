import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deployAge, rowLevel, matchesLevelFilter, type FleetRow } from './helpers'

const FIXED_NOW = new Date('2026-09-22T12:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function row(disk: number): FleetRow {
  return {
    name: 'proj',
    status: { disk } as FleetRow['status'],
    ciPassRate: null,
    backup: null,
  }
}

describe('deployAge', () => {
  it('handles null/undefined input', () => {
    expect(deployAge(null)).toBe('—')
    expect(deployAge(undefined)).toBe('—')
  })

  it('parses a Unix-seconds string, not "just now"', () => {
    const epochSec = String(Math.floor((FIXED_NOW - 3 * 3600_000) / 1000))
    expect(deployAge(epochSec)).toBe('3h ago')
  })

  it('parses a multi-day-old Unix-seconds string', () => {
    const epochSec = String(Math.floor((FIXED_NOW - 5 * 86_400_000) / 1000))
    expect(deployAge(epochSec)).toBe('5d ago')
  })

  it('still parses an ISO string', () => {
    const iso = new Date(FIXED_NOW - 2 * 3600_000).toISOString()
    expect(deployAge(iso)).toBe('2h ago')
  })

  it('returns — for garbage input', () => {
    expect(deployAge('not-a-timestamp')).toBe('—')
  })

  it('returns — for a future timestamp', () => {
    const epochSec = String(Math.floor((FIXED_NOW + 1000) / 1000))
    expect(deployAge(epochSec)).toBe('—')
  })
})

describe('matchesLevelFilter agreement with rowLevel', () => {
  it('the Warning tab shows exactly the warn rows, not fail rows too', () => {
    const rows = [row(95), row(80), row(80)] // fail, warn, warn
    expect(rows.map(rowLevel)).toEqual(['fail', 'warn', 'warn'])

    const warnCount = rows.filter(r => matchesLevelFilter(rowLevel(r), 'warn')).length
    const failCount = rows.filter(r => matchesLevelFilter(rowLevel(r), 'fail')).length
    expect(warnCount).toBe(2)
    expect(failCount).toBe(1)
  })

  it('"all" matches every level', () => {
    expect(matchesLevelFilter('ok', 'all')).toBe(true)
    expect(matchesLevelFilter('warn', 'all')).toBe(true)
    expect(matchesLevelFilter('fail', 'all')).toBe(true)
  })
})
