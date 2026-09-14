import { describe, it, expect } from 'vitest'
import {
  extractCertSection, extractCertbotSection, parseCertLines, parseCertbotSection,
  soonestExpiring, classifyRenewalHealth, type CertInfo, type CertbotStatus,
} from './cert-probe.js'

const NOW = new Date('2026-09-14T00:00:00Z').getTime()

describe('extractCertSection', () => {
  it('pulls lines between the markers', () => {
    const lines = ['5', '20', '---CERTS---', 'CERT|a|x', 'CERT|b|y', '---ENDCERTS---', 'backup']
    expect(extractCertSection(lines)).toEqual(['CERT|a|x', 'CERT|b|y'])
  })

  it('returns empty when no certs were found between markers', () => {
    const lines = ['5', '20', '---CERTS---', '---ENDCERTS---', 'backup']
    expect(extractCertSection(lines)).toEqual([])
  })

  it('returns empty when markers are missing', () => {
    expect(extractCertSection(['5', '20', 'backup'])).toEqual([])
  })
})

describe('parseCertLines', () => {
  it('parses multiple certs', () => {
    const certs = parseCertLines([
      'CERT|tastease.app|Nov 12 12:00:00 2026 GMT',
      'CERT|api.martialops.app|Nov 20 12:00:00 2026 GMT',
    ], NOW)
    expect(certs).toHaveLength(2)
    expect(certs.map(c => c.name)).toEqual(['tastease.app', 'api.martialops.app'])
    expect(certs[0]!.daysRemaining).toBeGreaterThan(certs[1]!.daysRemaining - 10)
  })

  it('skips a README entry', () => {
    const certs = parseCertLines(['CERT|README|', 'CERT|realsite.com|Nov 12 12:00:00 2026 GMT'], NOW)
    expect(certs).toHaveLength(1)
    expect(certs[0]!.name).toBe('realsite.com')
  })

  it('skips an unparseable date', () => {
    const certs = parseCertLines(['CERT|badsite.com|not-a-date'], NOW)
    expect(certs).toHaveLength(0)
  })

  it('returns empty when no certificates are present', () => {
    expect(parseCertLines([], NOW)).toEqual([])
  })

  it('ignores blank and malformed lines', () => {
    expect(parseCertLines(['', 'not-a-cert-line', 'CERT|onlyname'], NOW)).toEqual([])
  })

  it('computes days remaining relative to now', () => {
    const certs = parseCertLines(['CERT|site.com|Sep 24 00:00:00 2026 GMT'], NOW)
    expect(certs[0]!.daysRemaining).toBe(10)
  })
})

describe('soonestExpiring', () => {
  it('returns the cert with the fewest days remaining', () => {
    const certs = [
      { name: 'a', notAfter: '', daysRemaining: 40 },
      { name: 'b', notAfter: '', daysRemaining: 5 },
      { name: 'c', notAfter: '', daysRemaining: 20 },
    ]
    expect(soonestExpiring(certs)?.name).toBe('b')
  })

  it('returns undefined when no certificates are present', () => {
    expect(soonestExpiring([])).toBeUndefined()
  })
})

describe('extractCertbotSection', () => {
  it('pulls lines between the certbot markers', () => {
    const lines = ['---ENDCERTS---', '---CERTBOT---', 'RESULT=success', 'LASTRAN=x', 'RENEWERR=', '---ENDCERTBOT---']
    expect(extractCertbotSection(lines)).toEqual(['RESULT=success', 'LASTRAN=x', 'RENEWERR='])
  })

  it('returns empty when markers are missing', () => {
    expect(extractCertbotSection(['RESULT=success'])).toEqual([])
  })
})

describe('parseCertbotSection', () => {
  it('parses result, last-ran timestamp and error line — real diner-decider failure output', () => {
    const status = parseCertbotSection([
      'RESULT=exit-code',
      'LASTRAN=Mon 2026-09-14 17:36:22 UTC',
      'RENEWERR=Sep 14 17:36:22 diner-decider certbot[168335]: Failed to renew certificate dinerdecider.com ' +
        'with error: Could not bind TCP port 80 because it is already in use by another process on this system ' +
        '(such as a web server). Please stop the program in question and then try again.',
    ])
    expect(status.result).toBe('exit-code')
    expect(status.lastRanAt).toBe(new Date('2026-09-14T17:36:22Z').getTime())
    expect(status.errorLine).toContain('Could not bind TCP port 80')
  })

  it('parses a clean success run — real emit-vision output', () => {
    const status = parseCertbotSection(['RESULT=success', 'LASTRAN=Mon 2026-09-14 13:11:47 UTC', 'RENEWERR='])
    expect(status.result).toBe('success')
    expect(status.lastRanAt).not.toBeNull()
    expect(status.errorLine).toBeNull()
  })

  it('treats an empty LASTRAN as never-ran (no timer)', () => {
    const status = parseCertbotSection(['RESULT=success', 'LASTRAN=', 'RENEWERR='])
    expect(status.lastRanAt).toBeNull()
  })

  it('treats missing lines the same as empty values', () => {
    const status = parseCertbotSection([])
    expect(status).toEqual({ result: '', lastRanAt: null, errorLine: null })
  })
})

describe('classifyRenewalHealth', () => {
  const cert = (daysRemaining: number): CertInfo => ({ name: 'site.com', notAfter: '', daysRemaining })
  const status = (overrides: Partial<CertbotStatus>): CertbotStatus => ({
    result: 'success', lastRanAt: 1_000, errorLine: null, ...overrides,
  })

  it('is ok when the last run succeeded', () => {
    expect(classifyRenewalHealth(status({ result: 'success' }), [cert(60)])).toBe('ok')
  })

  it('is failing when the last run failed and the soonest cert is within 30 days', () => {
    expect(classifyRenewalHealth(status({ result: 'exit-code' }), [cert(25)])).toBe('failing')
  })

  it('is stale-failure when the last run failed but every cert is more than 30 days out — diner-decider case', () => {
    // diner-decider 2026-09-14: Result=exit-code (port-80 conflict, unrelated
    // to this cert), soonest cert ~90 days out — renewal isn't actually due.
    expect(classifyRenewalHealth(status({ result: 'exit-code' }), [cert(90)])).toBe('stale-failure')
  })

  it('is unknown when certbot.service has never run (no timer)', () => {
    expect(classifyRenewalHealth(status({ lastRanAt: null }), [cert(10)])).toBe('unknown')
  })

  it('is unknown when the result is unreadable', () => {
    expect(classifyRenewalHealth(status({ result: '' }), [cert(10)])).toBe('unknown')
  })

  it('is unknown when the last run failed but no certificate could be read at all', () => {
    expect(classifyRenewalHealth(status({ result: 'exit-code' }), [])).toBe('unknown')
  })
})
