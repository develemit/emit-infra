import { describe, it, expect } from 'vitest'
import { renderDeployFailedEmail } from './deploy.js'
import { deployFailed } from './fixtures.js'

describe('renderDeployFailedEmail', () => {
  it('has the subject, facts and rollback command', () => {
    const r = renderDeployFailedEmail(deployFailed)
    expect(r.subject).toBe('[emit-infra] 🔴 martialops deploy #812 failed')
    for (const s of ['a1b2c3d', 'main', '#812', '3m', 'Run: emit-infra rollback martialops', '.deploy-history.jsonl']) {
      expect(r.text).toContain(s)
    }
    expect(r.text).not.toContain('a1b2c3d4e5f6')
  })

  it('puts the escaped error in a <pre> block', () => {
    const r = renderDeployFailedEmail(deployFailed)
    expect(r.html).toMatch(/<pre[^>]*>docker build failed/)
    expect(r.html).toContain('&#39;string&#39;')
  })
})
