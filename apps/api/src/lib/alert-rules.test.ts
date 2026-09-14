import { describe, it, expect } from 'vitest'
import { evaluateRules, resolveRules, type AlertRule, type AlertMetrics, type AlertCooldownState } from './alert-rules.js'

const BASE_RULE: AlertRule = { metric: 'diskPct', op: 'gt', threshold: 80, enabled: true }
const NOW = 1_000_000

function rule(overrides: Partial<AlertRule>): AlertRule {
  return { ...BASE_RULE, ...overrides }
}

describe('evaluateRules', () => {
  it('fires when metric breaches threshold (gt)', () => {
    const { fired, newState } = evaluateRules('proj', [BASE_RULE], { diskPct: 85 }, {}, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ metric: 'diskPct', op: 'gt', threshold: 80, value: 85, firedAt: NOW })
    expect(newState['diskPct:gt:80']).toEqual({ firedAt: NOW, value: 85 })
  })

  it('fires when metric breaches threshold (lt)', () => {
    const r = rule({ metric: 'certDays', op: 'lt', threshold: 14 })
    const { fired } = evaluateRules('proj', [r], { certDays: 10 }, {}, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ metric: 'certDays', op: 'lt', threshold: 14, value: 10 })
  })

  it('does not fire when metric is within threshold (gt)', () => {
    const { fired, newState } = evaluateRules('proj', [BASE_RULE], { diskPct: 79 }, {}, NOW)
    expect(fired).toHaveLength(0)
    expect(newState).toEqual({})
  })

  it('does not fire when metric equals threshold (not strictly breached)', () => {
    const { fired } = evaluateRules('proj', [BASE_RULE], { diskPct: 80 }, {}, NOW)
    expect(fired).toHaveLength(0)
  })

  it('does not re-fire within cooldown window', () => {
    const prevState: AlertCooldownState = { 'diskPct:gt:80': { firedAt: NOW - 3600, value: 85 } }
    const { fired, newState } = evaluateRules('proj', [BASE_RULE], { diskPct: 90 }, prevState, NOW)
    expect(fired).toHaveLength(0)
    expect(newState['diskPct:gt:80']).toEqual({ firedAt: NOW - 3600, value: 85 })
  })

  it('re-fires after cooldown expires', () => {
    const prevState: AlertCooldownState = { 'diskPct:gt:80': { firedAt: NOW - 6 * 3600 - 1, value: 85 } }
    const { fired } = evaluateRules('proj', [BASE_RULE], { diskPct: 90 }, prevState, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]!.firedAt).toBe(NOW)
  })

  it('re-arms on recovery — fires again after metric dips below then re-breaches', () => {
    // First breach
    const { newState: state1 } = evaluateRules('proj', [BASE_RULE], { diskPct: 85 }, {}, NOW)
    expect(state1['diskPct:gt:80']).toBeDefined()

    // Recovery (not breached) — state cleared
    const { newState: state2 } = evaluateRules('proj', [BASE_RULE], { diskPct: 70 }, state1, NOW + 100)
    expect(state2['diskPct:gt:80']).toBeUndefined()

    // Breach again — should fire (no cooldown since state was cleared)
    const { fired } = evaluateRules('proj', [BASE_RULE], { diskPct: 90 }, state2, NOW + 200)
    expect(fired).toHaveLength(1)
  })

  it('skips missing metrics silently', () => {
    const metrics: AlertMetrics = { memPct: 60 }  // diskPct absent
    const { fired } = evaluateRules('proj', [BASE_RULE], metrics, {}, NOW)
    expect(fired).toHaveLength(0)
  })

  it('respects enabled: false', () => {
    const r = rule({ enabled: false })
    const { fired } = evaluateRules('proj', [r], { diskPct: 95 }, {}, NOW)
    expect(fired).toHaveLength(0)
  })

  it('handles multiple rules independently', () => {
    const rules: AlertRule[] = [
      rule({ metric: 'diskPct', op: 'gt', threshold: 80 }),
      rule({ metric: 'memPct', op: 'gt', threshold: 90 }),
      rule({ metric: 'certDays', op: 'lt', threshold: 30 }),
    ]
    const metrics: AlertMetrics = { diskPct: 85, memPct: 50, certDays: 10 }
    const { fired, newState } = evaluateRules('proj', rules, metrics, {}, NOW)
    expect(fired).toHaveLength(2)
    expect(fired.map(f => f.metric).sort()).toEqual(['certDays', 'diskPct'])
    expect(Object.keys(newState)).toHaveLength(2)
  })

  it('includes projectName in fired alerts', () => {
    const { fired } = evaluateRules('my-project', [BASE_RULE], { diskPct: 90 }, {}, NOW)
    expect(fired[0]!.projectName).toBe('my-project')
  })

  it('returns empty fired and state when rules array is empty', () => {
    const { fired, newState } = evaluateRules('proj', [], { diskPct: 90 }, {}, NOW)
    expect(fired).toHaveLength(0)
    expect(newState).toEqual({})
  })

  it('default certDays rule: 20 days left notifies, 22 does not, with no alertRules configured', () => {
    const rules = resolveRules([]) // no project alertRules — pure defaults
    expect(evaluateRules('proj', rules, { certDays: 20 }, {}, NOW).fired).toHaveLength(1)
    expect(evaluateRules('proj', rules, { certDays: 22 }, {}, NOW).fired).toHaveLength(0)
  })

  it('fires the certStatus default when no certificate is readable', () => {
    const rules = resolveRules([])
    const { fired } = evaluateRules('proj', rules, { certStatus: 1 }, {}, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ metric: 'certStatus', op: 'gt', threshold: 0, value: 1 })
  })

  it('fires the certRenewalFailing default when renewal is actionably failing', () => {
    const rules = resolveRules([])
    const { fired } = evaluateRules('proj', rules, { certRenewalFailing: 1 }, {}, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ metric: 'certRenewalFailing', op: 'gt', threshold: 0, value: 1 })
  })

  it('does not fire certRenewalFailing on a stale-failure (metric absent)', () => {
    const rules = resolveRules([])
    // status-monitor only sets certRenewalFailing on the 'failing' classification —
    // a stale-failure never sets it, so it's simply absent from metrics here.
    const { fired } = evaluateRules('proj', rules, { certDays: 90 }, {}, NOW)
    expect(fired.some(f => f.metric === 'certRenewalFailing')).toBe(false)
  })

  it('applies a rule-specific cooldown shorter than the default', () => {
    const rules = resolveRules([])
    const prevState: AlertCooldownState = {
      'certDays:lt:21': { firedAt: NOW - 3600, value: 5 }, // well within its 24h cooldown — stays quiet
      'certDays:lt:7': { firedAt: NOW - 6 * 3600, value: 5 }, // exactly at its 6h cooldown — re-arms
    }
    const { fired } = evaluateRules('proj', rules, { certDays: 5 }, prevState, NOW)
    expect(fired).toHaveLength(1)
    expect(fired[0]!.threshold).toBe(7)
  })

  it('a rule-specific cooldown still blocks re-firing before it elapses', () => {
    const rules = resolveRules([])
    const prevState: AlertCooldownState = { 'certDays:lt:21': { firedAt: NOW - 3600, value: 20 } }
    const { fired } = evaluateRules('proj', rules, { certDays: 20 }, prevState, NOW)
    // lt:21 tier has a 24h cooldown — only 1h has passed
    expect(fired).toHaveLength(0)
  })
})

describe('resolveRules', () => {
  it('applies certDays, certStatus and certRenewalFailing defaults when no project rules exist', () => {
    const rules = resolveRules([])
    expect(rules.map(r => `${r.metric}:${r.op}:${r.threshold}`).sort()).toEqual([
      'certDays:lt:21',
      'certDays:lt:7',
      'certRenewalFailing:gt:0',
      'certStatus:gt:0',
    ])
  })

  it("a project's own certDays rule replaces both certDays defaults", () => {
    const ownRule: AlertRule = { metric: 'certDays', op: 'lt', threshold: 3, enabled: true }
    const rules = resolveRules([ownRule])
    const certDaysRules = rules.filter(r => r.metric === 'certDays')
    expect(certDaysRules).toHaveLength(1)
    expect(certDaysRules[0]).toMatchObject({ threshold: 3 })
    // certStatus and certRenewalFailing defaults are unrelated to certDays and stay
    expect(rules.some(r => r.metric === 'certStatus')).toBe(true)
    expect(rules.some(r => r.metric === 'certRenewalFailing')).toBe(true)
  })

  it("other metrics stay opt-in — a project's diskPct rule doesn't disturb cert defaults", () => {
    const ownRule: AlertRule = { metric: 'diskPct', op: 'gt', threshold: 90, enabled: true }
    const rules = resolveRules([ownRule])
    expect(rules).toHaveLength(5) // 4 cert defaults + the project's own diskPct rule
    expect(rules.filter(r => r.metric === 'certDays')).toHaveLength(2)
  })

  it('default certDays rules use 24h/6h cooldowns, not the global default', () => {
    const rules = resolveRules([])
    const lt21 = rules.find(r => r.metric === 'certDays' && r.threshold === 21)
    const lt7 = rules.find(r => r.metric === 'certDays' && r.threshold === 7)
    expect(lt21?.cooldownSec).toBe(24 * 3600)
    expect(lt7?.cooldownSec).toBe(6 * 3600)
  })
})
