import { describe, it, expect } from 'vitest'
import { backupProbeCmd, parseBackupSection } from './probe-parse.js'

const NOW = Date.parse('2026-10-06T12:00:00Z')

describe('parseBackupSection', () => {
  it('computes age and no failure for an ok status', () => {
    const m = parseBackupSection(['x', 'BACKUP|2026-10-05T06:00:00Z|ok'], NOW)
    expect(m.backupAgeHours).toBeCloseTo(30)
    expect(m.backupFailed).toBeUndefined()
    expect(m.backupStatus).toBe('ok')
  })

  it('sets backupFailed only for status failed', () => {
    expect(parseBackupSection(['BACKUP|2026-10-06T06:00:00Z|failed'], NOW).backupFailed).toBe(1)
  })

  it('returns nothing when the status file is missing', () => {
    expect(parseBackupSection(['BACKUP||'], NOW)).toEqual({})
    expect(parseBackupSection(['unrelated'], NOW)).toEqual({})
  })

  it('ignores an unparseable lastRun', () => {
    expect(parseBackupSection(['BACKUP|garbage|ok'], NOW).backupAgeHours).toBeUndefined()
  })
})

describe('backupProbeCmd', () => {
  it('reads both fields from the project status file', () => {
    const cmd = backupProbeCmd('app')
    expect(cmd).toContain('/opt/app/.backup-status.json')
    expect(cmd).toContain('"lastRun"')
    expect(cmd).toContain('"status"')
  })
})
