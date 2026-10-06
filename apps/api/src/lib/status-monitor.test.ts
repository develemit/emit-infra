import { describe, it, expect, vi } from 'vitest'
import { formatAlertNotification, enrichFiredAlert } from './status-monitor.js'
import type { FiredAlert, AlertMetrics } from './alert-rules.js'

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

  it('uses detail text when present, instead of the generic metric/op/threshold line', () => {
    const payload = formatAlertNotification([
      fired({ metric: 'certDays', op: 'lt', threshold: 21, value: 20, detail: 'tastease.app: 20d left — renewal is failing.' }),
    ])
    expect(payload.body).toBe('tastease.app: 20d left — renewal is failing.')
  })

  it('bundles detail text alongside generic lines for mixed alerts', () => {
    const alerts = [
      fired({ metric: 'diskPct', op: 'gt', threshold: 90, value: 92 }),
      fired({ metric: 'certStatus', op: 'gt', threshold: 0, value: 1, detail: 'No readable certificate found.' }),
    ]
    const payload = formatAlertNotification(alerts)
    expect(payload.body).toBe('2 alerts: disk 92 > 90, No readable certificate found.')
  })
})

describe('enrichFiredAlert', () => {
  it('puts certbot\'s own error line into the certRenewalFailing detail', () => {
    const alert = fired({ metric: 'certRenewalFailing', op: 'gt', threshold: 0, value: 1 })
    const metrics: AlertMetrics = {
      certbotError: 'Failed to renew certificate dinerdecider.com with error: Could not bind TCP port 80 ' +
        'because it is already in use by another process on this system (such as a web server).',
    }
    const enriched = enrichFiredAlert(alert, metrics)
    expect(enriched.detail).toContain('Could not bind TCP port 80')
  })

  it('falls back to a generic message when certRenewalFailing fires with no captured error line', () => {
    const alert = fired({ metric: 'certRenewalFailing', op: 'gt', threshold: 0, value: 1 })
    const enriched = enrichFiredAlert(alert, {})
    expect(enriched.detail).toBe('certbot renewal is failing: no error line found in the certbot journal')
  })

  it('leaves non-cert alerts untouched', () => {
    const alert = fired({ metric: 'diskPct', op: 'gt', threshold: 80, value: 92 })
    expect(enrichFiredAlert(alert, {})).toBe(alert)
  })
})

describe('poll — reserved documentation hosts', () => {
  it('runs no probe and sends no notification for a reserved host', async () => {
    vi.resetModules()
    const sshExec = vi.fn()
    const notify = vi.fn()
    const handleHealthEvents = vi.fn()
    vi.doMock('@emit-infra/core', () => ({ sshExec }))
    vi.doMock('./notify.js', () => ({ notify }))
    vi.doMock('./health-notify.js', () => ({ handleHealthEvents, seedHealthMaps: vi.fn() }))
    vi.doMock('./discover-projects.js', () => ({
      discoverProjects: async () => [{ config: { name: 'test-smoke', domain: '192.0.2.1', healthCheck: { url: 'http://192.0.2.1/' } } }],
    }))
    const { poll } = await import('./status-monitor.js')
    await poll()
    expect(sshExec).not.toHaveBeenCalled()
    expect(handleHealthEvents).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    vi.doUnmock('@emit-infra/core')
    vi.doUnmock('./notify.js')
    vi.doUnmock('./health-notify.js')
    vi.doUnmock('./discover-projects.js')
  })
})
