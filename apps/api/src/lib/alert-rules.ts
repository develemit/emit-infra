import { z } from 'zod'

export const AlertRuleSchema = z.object({
  metric: z.enum(['diskPct', 'memPct', 'certDays', 'backupAgeHours']),
  op: z.enum(['gt', 'lt']),
  threshold: z.number(),
  enabled: z.boolean(),
})
export type AlertRule = z.infer<typeof AlertRuleSchema>

export interface AlertMetrics {
  diskPct?: number | undefined
  memPct?: number | undefined
  certDays?: number | undefined
  backupAgeHours?: number | undefined
}

export interface FiredAlert {
  projectName: string
  metric: string
  op: string
  threshold: number
  value: number
  firedAt: number
}

// key: "${metric}:${op}:${threshold}"
export type AlertCooldownState = Record<string, { firedAt: number; value: number }>

const COOLDOWN_SEC = 6 * 3600

export function evaluateRules(
  projectName: string,
  rules: AlertRule[],
  metrics: AlertMetrics,
  state: AlertCooldownState,
  nowSec = Math.floor(Date.now() / 1000),
): { fired: FiredAlert[]; newState: AlertCooldownState } {
  const newState: AlertCooldownState = {}
  const fired: FiredAlert[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    const value = metrics[rule.metric]
    if (value === undefined) continue

    const key = `${rule.metric}:${rule.op}:${rule.threshold}`
    const prevFire = state[key]
    const breached = rule.op === 'gt' ? value > rule.threshold : value < rule.threshold

    if (breached) {
      if (!prevFire || nowSec - prevFire.firedAt >= COOLDOWN_SEC) {
        fired.push({ projectName, metric: rule.metric, op: rule.op, threshold: rule.threshold, value, firedAt: nowSec })
        newState[key] = { firedAt: nowSec, value }
      } else {
        // Still in cooldown — carry forward so the key stays in state
        newState[key] = prevFire
      }
    }
    // Not breached → key not carried into newState → rule re-arms on next breach
  }

  return { fired, newState }
}
