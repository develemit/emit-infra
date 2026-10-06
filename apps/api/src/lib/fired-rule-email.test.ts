import { describe, it, expect, vi } from 'vitest'

const { trendLast24h } = vi.hoisted(() => ({ trendLast24h: vi.fn() }))
vi.mock('./email-context.js', () => ({ trendLast24h }))

import { buildAlertRuleEmail } from './fired-rule-email.js'
import type { FiredAlert } from './alert-rules.js'

const fired = (o: Partial<FiredAlert>): FiredAlert => ({ projectName: 'app', metric: 'diskPct', op: 'gt', threshold: 80, value: 91, firedAt: 1, ...o })

describe('buildAlertRuleEmail', () => {
  it('renders disk alerts with the 24h trend', async () => {
    trendLast24h.mockResolvedValue({ current: 91, pctPerDay: 2, projectedDaysUntilFull: 4 })
    const email = await buildAlertRuleEmail('app', '1.2.3.4', [fired({})], {}, 1_800_000_000_000)
    expect(email.subject).toBe('[emit-infra] 🟠 app disk usage at 91%')
    expect(email.text).toContain('+2.0%/day')
    expect(email.text).toContain('1.2.3.4')
  })

  it('renders backup alerts with last run and status', async () => {
    const last = Date.parse('2026-10-04T00:00:00Z')
    const email = await buildAlertRuleEmail(
      'app', undefined, [fired({ metric: 'backupFailed', value: 1, threshold: 0 })],
      { backupLastRunMs: last, backupStatus: 'failed' }, Date.parse('2026-10-06T00:00:00Z'),
    )
    expect(email.text).toContain('failed')
    expect(email.text).toContain('Last backup run')
  })
})
