import { describe, it, expect } from 'vitest'
import { renderDigestEmail } from './digest.js'
import { digest } from './fixtures.js'

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

  it('uses the info tone when there are no incidents', () => {
    const quiet = { ...digest, projects: digest.projects.map((p) => ({ ...p, incidents: 0 })) }
    expect(renderDigestEmail(quiet).html).toContain('#2563eb')
  })
})
