import { describe, it, expect } from 'vitest'
import { renderDeployFailedEmail } from './deploy.js'
import { deployFailed, deployFailedHealth } from './fixtures.js'

describe('renderDeployFailedEmail', () => {
  it('has the subject and facts', () => {
    const r = renderDeployFailedEmail(deployFailed)
    expect(r.subject).toBe('[emit-infra] 🔴 martialops deploy #812 failed')
    for (const s of ['a1b2c3d', 'main', '#812', '3m', 'previous build should still be serving']) {
      expect(r.text).toContain(s)
    }
    expect(r.text).not.toContain('a1b2c3d4e5f6')
  })

  it('puts the escaped error in a <pre> block', () => {
    const r = renderDeployFailedEmail(deployFailed)
    expect(r.html).toMatch(/<pre[^>]*>docker build failed/)
    expect(r.html).toContain('&#39;string&#39;')
  })

  it('a build failure says no rollback is needed and does not suggest one', () => {
    const r = renderDeployFailedEmail(deployFailed)
    expect(r.text).toContain('no rollback needed')
    expect(r.text).not.toContain('emit-infra rollback')
    expect(r.text).toContain('/tmp/emit-deploy-martialops-a1b2c3d.log')
    expect(r.text).not.toContain('.deploy-history')
    expect(r.firstStep).toContain('no rollback needed')
  })

  it('a post-switch health failure puts rollback first', () => {
    const r = renderDeployFailedEmail(deployFailedHealth)
    expect(r.text.indexOf('emit-infra rollback martialops')).toBeGreaterThan(-1)
    expect(r.text).toContain('Production may be serving the new build.')
    expect(r.text).not.toContain('previous build should still be serving')
    expect(r.firstStep).toContain('Roll back first')
  })
})
