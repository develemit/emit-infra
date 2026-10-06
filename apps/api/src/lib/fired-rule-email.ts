import type { AlertMetrics, FiredAlert } from './alert-rules.js'
import { trendLast24h } from './email-context.js'
import { renderAlertRuleEmail, type FiredRuleView } from './email-templates/alert-rule.js'
import type { RenderedEmail } from './email-templates/types.js'

async function viewOf(alert: FiredAlert, metrics: AlertMetrics, nowMs: number): Promise<FiredRuleView> {
  const view: FiredRuleView = {
    metric: alert.metric,
    op: alert.op as 'gt' | 'lt',
    threshold: alert.threshold,
    value: alert.value,
    ...(alert.detail && { detail: alert.detail }),
  }
  if (alert.metric === 'diskPct' || alert.metric === 'memPct') {
    const trend = await trendLast24h(alert.projectName, alert.metric === 'diskPct' ? 'disk' : 'mem', nowMs)
    if (trend) view.trend = trend
  }
  if (alert.metric.startsWith('cert')) {
    if (metrics.certName) view.certName = metrics.certName
    if (metrics.certDays !== undefined) view.certDaysLeft = metrics.certDays
    if (metrics.certbotError) view.certError = metrics.certbotError
  }
  if (alert.metric.startsWith('backup')) {
    if (metrics.backupLastRunMs !== undefined) view.backupLastRunMs = metrics.backupLastRunMs
    if (metrics.backupStatus) view.backupStatus = metrics.backupStatus
  }
  return view
}

export async function buildAlertRuleEmail(
  project: string,
  serverIp: string | undefined,
  fired: FiredAlert[],
  metrics: AlertMetrics,
  nowMs = Date.now(),
): Promise<RenderedEmail> {
  const rules = await Promise.all(fired.map((a) => viewOf(a, metrics, nowMs)))
  return renderAlertRuleEmail({ project, ...(serverIp && { serverIp }), rules, nowMs })
}
