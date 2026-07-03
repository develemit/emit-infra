import { describe, it, expect } from 'vitest'
import { evaluateRules, type AlertRule, type AlertMetrics, type AlertCooldownState } from './alert-rules.js'

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
})
