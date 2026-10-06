import { describe, it, expect } from 'vitest'
import { renderDigestEmail } from './digest.js'
import { digest, digestHealthy } from './fixtures.js'

describe('renderDigestEmail', () => {
  it('has the subject and one row per project', () => {
    const r = renderDigestEmail(digest)
    expect(r.subject).toBe('[emit-infra] 📊 Weekly fleet digest — 3 projects, 2 incidents')
    for (const s of ['🟢 tastease', '🔴 diner-decider', '82% (+6)', '5d', '3d']) {
      expect(r.text).toContain(s)
    }
  })

  it('tints values outside healthy ranges', () => {
    const { html } = renderDigestEmail(digest)
    expect(html).toContain('color:#dc2626;font-weight:600;">93% (+1)')
    expect(html).toContain('color:#d97706;font-weight:600;">82% (+6)')
  })

  it('a digest with red findings has a critical tone', () => {
    expect(renderDigestEmail(digest).tone).toBe('critical')
    expect(renderDigestEmail(digest).html).toContain('#dc2626')
  })

  it('lists needs-attention items worst first, each with a first step', () => {
    const { text } = renderDigestEmail(digest)
    const section = text.slice(text.indexOf('NEEDS ATTENTION'), text.indexOf('PER PROJECT'))
    expect(section).toContain('First step')
    expect(section).toContain('Disk at 93%')
    expect(section).toContain('Certificate expires in 5 days')
    expect(section).toContain('See what is using space')
    const lines = section.split('\n').filter((l) => l.includes(' | ') && !l.startsWith('Project'))
    const whens = lines.map((l) => l.split(' | ').pop())
    expect(whens.indexOf('DO SOON')).toBeGreaterThan(whens.lastIndexOf('DO NOW'))
  })

  it('includes per-project What to do steps', () => {
    const { text } = renderDigestEmail(digest)
    expect(text).toContain('DINER-DECIDER: DISK AT 93%')
    expect(text).toContain('certbot renew --dry-run')
  })

  it('a healthy week is green and says nothing needs attention', () => {
    const r = renderDigestEmail(digestHealthy)
    expect(r.tone).toBe('recovered')
    expect(r.text).toContain('Nothing needs attention this week')
    expect(r.html).toContain('#16a34a')
    expect(r.firstStep).toBeUndefined()
  })

  it('an amber-only week is a warning', () => {
    const amber = { ...digestHealthy, projects: [{ ...digestHealthy.projects[0]!, diskPct: 82 }] }
    expect(renderDigestEmail(amber).tone).toBe('warning')
  })
})
