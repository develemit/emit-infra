import { describe, it, expect } from 'vitest'
import { remediate } from './index.js'
import type { Finding } from './types.js'

const base = { project: 'app', serverIp: '203.0.113.5' }
const urgency = (f: Finding) => remediate(f).urgency

describe('disk urgency', () => {
  it.each([[79, 'none'], [80, 'soon'], [89, 'soon'], [90, 'now']] as const)('%i%% is %s', (pct, want) => {
    expect(urgency({ ...base, kind: 'disk', pct })).toBe(want)
  })
  it('is now when projected full in under 7 days', () => {
    expect(urgency({ ...base, kind: 'disk', pct: 70, projectedDaysUntilFull: 6.5 })).toBe('now')
    expect(urgency({ ...base, kind: 'disk', pct: 70, projectedDaysUntilFull: 7 })).toBe('none')
  })
  it('starts with a command using the real server ip', () => {
    expect(remediate({ ...base, kind: 'disk', pct: 91 }).steps[0]!.command).toContain('ssh root@203.0.113.5')
  })
})

describe('cert urgency', () => {
  it.each([[22, 'none'], [21, 'none'], [20, 'soon'], [7, 'soon'], [6, 'now']] as const)('%i days is %s', (daysLeft, want) => {
    expect(urgency({ ...base, kind: 'cert', daysLeft })).toBe(want)
  })
  it('includes the certbot error and starts with a dry run', () => {
    const r = remediate({ ...base, kind: 'cert', daysLeft: 5, error: 'port 80 in use' })
    expect(r.steps[0]!.text).toContain('port 80 in use')
    expect(r.steps[1]!.command).toContain('certbot renew --dry-run')
  })
})

describe('backup urgency', () => {
  it.each([[29, undefined, 'none'], [30, undefined, 'none'], [31, undefined, 'now'], [2, 'failed', 'now']] as const)('%ih / %s is %s', (ageHours, status, want) => {
    expect(urgency({ ...base, kind: 'backup', ageHours, status })).toBe(want)
  })
  it('reads the status file first', () => {
    expect(remediate({ ...base, kind: 'backup', ageHours: 50 }).steps[0]!.command).toContain('/opt/app/.backup-status.json')
  })
})

describe('mem and incidents urgency', () => {
  it('mem 79/80/90', () => {
    expect([79, 80, 90].map((pct) => urgency({ ...base, kind: 'mem', pct }))).toEqual(['none', 'soon', 'now'])
  })
  it('incidents 0/1/3', () => {
    expect([0, 1, 3].map((count) => urgency({ ...base, kind: 'incidents', count }))).toEqual(['none', 'watch', 'soon'])
  })
})

describe('health cause → first step', () => {
  const health = (status?: number) => remediate({ ...base, kind: 'health', check: 'http', status })
  it('502 checks container state first', () => expect(health(502).steps[0]!.command).toContain('docker compose ps'))
  it('timeout checks emit-infra status first', () => expect(health(undefined).steps[0]!.command).toBe('emit-infra status app'))
  it('504 is treated as a timeout', () => expect(health(504).steps[0]!.command).toBe('emit-infra status app'))
  it('TLS statuses start with certbot', () => expect(health(526).steps[0]!.command).toContain('certbot'))
  it('500 starts with app logs', () => expect(health(500).steps[0]!.command).toContain('emit-infra logs'))
  it('recovered needs no action', () => {
    const r = remediate({ ...base, kind: 'health', check: 'http', recovered: true, durationMs: 14 * 60_000 })
    expect(r.urgency).toBe('none')
    expect(r.steps[0]!.text).toContain('No action needed')
    expect(r.steps[0]!.text).toContain('14-minute')
  })
  it('ssh outage is now', () => expect(remediate({ ...base, kind: 'health', check: 'ssh' }).urgency).toBe('now'))
})
