import { describe, it, expect } from 'vitest'
import { extractCertSection, parseCertLines, soonestExpiring } from './cert-probe.js'

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
