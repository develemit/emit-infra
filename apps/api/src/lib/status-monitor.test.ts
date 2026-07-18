import { describe, it, expect } from 'vitest'
import { formatAlertNotification } from './status-monitor.js'
import type { FiredAlert } from './alert-rules.js'

const NOW = 1_000_000

function fired(overrides: Partial<FiredAlert>): FiredAlert {
  return {
    projectName: 'my-project',
    metric: 'diskPct',
    op: 'gt',
    threshold: 80,
    value: 92,
    firedAt: NOW,
    ...overrides,
  }
}

describe('formatAlertNotification', () => {
  it('single alert — disk gt', () => {
    const payload = formatAlertNotification([fired({})])
    expect(payload.title).toBe('my-project')
    expect(payload.body).toBe('disk 92 > 80')
    expect(payload.tag).toBe('alert:my-project:diskPct')
    expect(payload.url).toBe('/projects/my-project/reliability')
  })

  it('single alert — cert days lt', () => {
    const payload = formatAlertNotification([fired({ metric: 'certDays', op: 'lt', threshold: 14, value: 5 })])
    expect(payload.body).toBe('cert days 5 < 14')
    expect(payload.tag).toBe('alert:my-project:certDays')
  })

  it('single alert — unknown metric falls back to metric key', () => {
    const payload = formatAlertNotification([fired({ metric: 'unknownMetric', op: 'gt', threshold: 50, value: 60 })])
    expect(payload.body).toBe('unknownMetric 60 > 50')
    expect(payload.tag).toBe('alert:my-project:unknownMetric')
  })

  it('multiple alerts → bundled notification with count and summaries', () => {
    const alerts = [
      fired({ metric: 'diskPct', op: 'gt', threshold: 90, value: 92 }),
      fired({ metric: 'memPct', op: 'gt', threshold: 80, value: 85 }),
      fired({ metric: 'certDays', op: 'lt', threshold: 14, value: 5 }),
    ]
    const payload = formatAlertNotification(alerts)
    expect(payload.title).toBe('my-project')
    expect(payload.body).toBe('3 alerts: disk 92 > 90, memory 85 > 80, cert days 5 < 14')
    expect(payload.tag).toBe('alert:my-project:bundle')
    expect(payload.url).toBe('/projects/my-project/reliability')
  })

  it('two alerts → bundle tag, not single-metric tag', () => {
    const payload = formatAlertNotification([
      fired({ metric: 'diskPct', op: 'gt', threshold: 80, value: 90 }),
      fired({ metric: 'memPct', op: 'gt', threshold: 70, value: 80 }),
    ])
    expect(payload.tag).toBe('alert:my-project:bundle')
    expect(payload.body).toBe('2 alerts: disk 90 > 80, memory 80 > 70')
  })

  it('url encodes project name with special characters', () => {
    const payload = formatAlertNotification([fired({ projectName: 'my project/test' })])
    expect(payload.url).toBe('/projects/my%20project%2Ftest/reliability')
  })

  it('rounds fractional values', () => {
    const payload = formatAlertNotification([fired({ value: 92.7, threshold: 80 })])
    expect(payload.body).toBe('disk 93 > 80')
  })
})
