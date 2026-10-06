import { describe, it, expect } from 'vitest'
import { renderHealthEmail } from './health.js'
import { TONE_COLOR } from './layout.js'
import { healthDown, healthRecovered, healthTimeout } from './fixtures.js'

describe('renderHealthEmail', () => {
  it('down: subject, facts, incidents and actions', () => {
    const r = renderHealthEmail(healthDown)
    expect(r.subject).toBe('[emit-infra] 🔴 tastease DOWN — HTTP 502')
    for (const s of ['203.0.113.10', 'bad gateway (HTTP 502)', 'Down since', 'Last good check', 'Incidents in the last 7 days (2)']) {
      expect(r.html).toContain(s)
    }
    expect(r.text).toContain('Run: emit-infra status tastease')
    expect(r.text).toContain('Run: /triage-prod')
    expect(r.html).toContain(TONE_COLOR.critical)
  })

  it('reminder subject carries the duration', () => {
    const r = renderHealthEmail({ ...healthDown, kind: 'reminder', durationMs: 3 * 3_600_000 })
    expect(r.subject).toBe('[emit-infra] 🔴 tastease still DOWN (3h 0m) — HTTP 502')
  })

  it('ssh check has its own cause', () => {
    const r = renderHealthEmail({ ...healthDown, check: 'ssh', status: undefined as never })
    expect(r.subject).toContain('SSH unreachable')
  })

  it('recovered: green tone and states the duration', () => {
    const r = renderHealthEmail(healthRecovered)
    expect(r.subject).toBe('[emit-infra] 🟢 tastease recovered after 14m')
    expect(r.html).toContain(TONE_COLOR.recovered)
    expect(r.text).toContain('Total downtime: 14m')
  })

  it('includes What to do steps matched to the cause', () => {
    const r502 = renderHealthEmail(healthDown)
    expect(r502.text).toContain('docker compose ps')
    expect(r502.text).toContain('ssh root@203.0.113.10')
    expect(r502.firstStep).toBeTruthy()
    expect(renderHealthEmail(healthTimeout).text).toContain('overloaded or unreachable')
  })

  it('recovery says no action is needed', () => {
    const r = renderHealthEmail(healthRecovered)
    expect(r.text).toContain('No action needed')
    expect(r.firstStep).toBeUndefined()
  })
})
