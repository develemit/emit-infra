import { z } from 'zod'

export const AlertRuleSchema = z.object({
  metric: z.enum(['diskPct', 'memPct', 'certDays', 'backupAgeHours']),
  op: z.enum(['gt', 'lt']),
  threshold: z.number(),
  enabled: z.boolean(),
})
export type AlertRule = z.infer<typeof AlertRuleSchema>

// 'certStatus', 'certRenewalFailing' and 'backupFailed' back built-in alerts.
// None is user-configurable, so they live outside AlertRuleSchema's metric enum.
type Metric = AlertRule['metric'] | 'certStatus' | 'certRenewalFailing' | 'backupFailed'

interface EvaluatedRule {
  metric: Metric
  op: 'gt' | 'lt'
  threshold: number
  enabled: boolean
  cooldownSec?: number
}

export interface AlertMetrics {
  diskPct?: number | undefined
  memPct?: number | undefined
  certDays?: number | undefined
  backupAgeHours?: number | undefined
  // 1 when a project's server yielded no readable certificate at all; absent
  // (not 0) when a certificate was found, so it never breaches by omission.
  certStatus?: number | undefined
  // Name of the soonest-expiring certificate — contextual only, never
  // evaluated against a rule threshold.
  certName?: string | undefined
  // 1 when certbot's last run failed AND the soonest certificate is inside
  // its 30-day renewal window; absent otherwise (including the stale case
  // where the last run failed but no certificate is actually due yet).
  certRenewalFailing?: number | undefined
  // certbot's own error line for the last failed run — contextual only,
  // never evaluated against a rule threshold.
  certbotError?: string | undefined
  // 1 when .backup-status.json says "failed"; absent (not 0) otherwise, and
  // absent when the project has no status file at all.
  backupFailed?: number | undefined
  // Contextual only (email detail), never evaluated against a threshold.
  backupLastRunMs?: number | undefined
  backupStatus?: string | undefined
}

export interface FiredAlert {
  projectName: string
  metric: string
  op: string
  threshold: number
  value: number
  firedAt: number
  detail?: string
}

// key: "${metric}:${op}:${threshold}"
export type AlertCooldownState = Record<string, { firedAt: number; value: number }>

const DEFAULT_COOLDOWN_SEC = 6 * 3600

// certbot renews at 30 days remaining. Under 21 means renewal has been
// failing for over a week — daily reminder. Under 7 is urgent — every 6h.
export const DEFAULT_RULES: EvaluatedRule[] = [
  { metric: 'certDays', op: 'lt', threshold: 21, enabled: true, cooldownSec: 24 * 3600 },
  { metric: 'certDays', op: 'lt', threshold: 7, enabled: true, cooldownSec: 6 * 3600 },
  { metric: 'certStatus', op: 'gt', threshold: 0, enabled: true, cooldownSec: 24 * 3600 },
  // Catches renewal failing well before certDays would (day one of failure,
  // not 21 days before expiry) — but only once a cert is actually due, so a
  // stale failed-run result on a cert with weeks of slack stays silent.
  { metric: 'certRenewalFailing', op: 'gt', threshold: 0, enabled: true, cooldownSec: 24 * 3600 },
  // A backup that silently stopped is the costliest failure to find late.
  // Projects with no status file leave both metrics undefined and stay silent.
  { metric: 'backupAgeHours', op: 'gt', threshold: 30, enabled: true, cooldownSec: 12 * 3600 },
  { metric: 'backupFailed', op: 'gt', threshold: 0, enabled: true, cooldownSec: 12 * 3600 },
]

/**
 * Merges a project's own alertRules with the built-in defaults (certificate
 * expiry and backups). A project's own certDays or backupAgeHours rule(s)
 * replace that metric's defaults entirely; every other default stays as-is.
 * Disk and memory remain fully opt-in.
 */
export function resolveRules(projectRules: AlertRule[]): EvaluatedRule[] {
  const overridden = new Set<string>(projectRules.map(r => r.metric))
  const defaults = DEFAULT_RULES.filter(r => (r.metric !== 'certDays' && r.metric !== 'backupAgeHours') || !overridden.has(r.metric))
  return [...defaults, ...projectRules]
}

export function evaluateRules(
  projectName: string,
  rules: EvaluatedRule[],
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

    const cooldownSec = rule.cooldownSec ?? DEFAULT_COOLDOWN_SEC
    const key = `${rule.metric}:${rule.op}:${rule.threshold}`
    const prevFire = state[key]
    const breached = rule.op === 'gt' ? value > rule.threshold : value < rule.threshold

    if (breached) {
      if (!prevFire || nowSec - prevFire.firedAt >= cooldownSec) {
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
