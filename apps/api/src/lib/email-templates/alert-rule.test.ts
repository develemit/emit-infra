import { describe, it, expect } from 'vitest'
import { renderAlertRuleEmail } from './alert-rule.js'
import { alertRule } from './fixtures.js'

describe('renderAlertRuleEmail', () => {
  it('lists every fired rule with trend, cert and backup facts', () => {
    const r = renderAlertRuleEmail(alertRule)
    expect(r.subject).toBe('[emit-infra] 🟠 diner-decider — 3 alerts firing')
    for (const s of ['Disk usage', '> 85', '↑ +1.5%/day, full in ~6 days', 'diner-decider.example.com', 'Could not bind TCP port 80', 'Last backup run', 'failed']) {
      expect(r.text).toContain(s)
    }
    expect(r.text).toContain('Run: emit-infra status diner-decider')
    expect(r.text).toContain('/projects/diner-decider/reliability')
  })

  it('single cert rule gets the days-left subject', () => {
    const r = renderAlertRuleEmail({ ...alertRule, rules: [alertRule.rules[1]!] })
    expect(r.subject).toBe('[emit-infra] 🟠 diner-decider cert expires in 6 days')
  })

  it('single disk rule shows the percentage', () => {
    const r = renderAlertRuleEmail({ ...alertRule, rules: [alertRule.rules[0]!] })
    expect(r.subject).toBe('[emit-infra] 🟠 diner-decider disk usage at 91%')
  })
})
