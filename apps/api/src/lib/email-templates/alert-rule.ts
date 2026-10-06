import type { LinearTrend } from '../trend.js'
import { renderLayout, type Section, type Tone } from './layout.js'
import { dashboardUrl, formatTime, plural } from './format.js'
import type { RenderedEmail } from './types.js'

export interface FiredRuleView {
  metric: string
  op: 'gt' | 'lt'
  threshold: number
  value: number
  detail?: string
  trend?: LinearTrend
  certName?: string
  certDaysLeft?: number
  certError?: string
  backupLastRunMs?: number
  backupStatus?: string
}

export interface AlertRuleEmailInput {
  project: string
  serverIp?: string
  rules: FiredRuleView[]
  nowMs: number
}

const LABELS: Record<string, string> = {
  diskPct: 'Disk usage',
  memPct: 'Memory usage',
  certDays: 'Certificate days left',
  certStatus: 'Certificate readable',
  certRenewalFailing: 'Certificate renewal',
  backupAgeHours: 'Backup age (hours)',
}

const label = (m: string): string => LABELS[m] ?? m

function arrow(t: LinearTrend): string {
  if (t.pctPerDay > 0.1) return '↑'
  if (t.pctPerDay < -0.1) return '↓'
  return '→'
}

function trendText(t: LinearTrend): string {
  const rate = `${t.pctPerDay >= 0 ? '+' : ''}${t.pctPerDay.toFixed(1)}%/day`
  const full = t.projectedDaysUntilFull !== null ? `, full in ~${plural(Math.max(0, Math.round(t.projectedDaysUntilFull)), 'day')}` : ''
  return `${arrow(t)} ${rate}${full}`
}

function ruleSection(r: FiredRuleView, nowMs: number): Section {
  const rows: Array<[string, string]> = [
    ['Current', `${Math.round(r.value)}`],
    ['Threshold', `${r.op === 'gt' ? '>' : '<'} ${r.threshold}`],
  ]
  if (r.trend) rows.push(['24h trend', trendText(r.trend)])
  if (r.certName) rows.push(['Certificate', r.certName])
  if (r.certDaysLeft !== undefined) rows.push(['Days left', String(Math.round(r.certDaysLeft))])
  if (r.certError) rows.push(['certbot error', r.certError])
  if (r.backupLastRunMs !== undefined) rows.push(['Last backup run', formatTime(r.backupLastRunMs, nowMs)])
  if (r.backupStatus) rows.push(['Backup status', r.backupStatus])
  if (r.detail) rows.push(['Detail', r.detail])
  return { title: label(r.metric), kind: 'list', rows }
}

function subjectFor(i: AlertRuleEmailInput): string {
  if (i.rules.length > 1) return `[emit-infra] 🟠 ${i.project} — ${i.rules.length} alerts firing`
  const r = i.rules[0]!
  if (r.metric === 'certDays') return `[emit-infra] 🟠 ${i.project} cert expires in ${plural(Math.round(r.certDaysLeft ?? r.value), 'day')}`
  if (r.metric === 'certStatus') return `[emit-infra] 🟠 ${i.project} has no readable certificate`
  if (r.metric === 'certRenewalFailing') return `[emit-infra] 🟠 ${i.project} cert renewal failing`
  if (r.metric === 'backupAgeHours') return `[emit-infra] 🟠 ${i.project} backup is ${Math.round(r.value)}h old`
  return `[emit-infra] 🟠 ${i.project} ${label(r.metric).toLowerCase()} at ${Math.round(r.value)}%`
}

export function renderAlertRuleEmail(i: AlertRuleEmailInput): RenderedEmail {
  const tone: Tone = 'warning'
  const names = i.rules.map((r) => label(r.metric)).join(', ')
  const facts: Array<[string, string]> = [['Project', i.project]]
  if (i.serverIp) facts.push(['Server IP', i.serverIp])
  facts.push(['Rules fired', String(i.rules.length)])
  const { html, text } = renderLayout({
    tone,
    preheader: names,
    headline: `${i.project}: ${plural(i.rules.length, 'alert')} firing`,
    summary: `Triggered: ${names}.`,
    facts,
    sections: i.rules.map((r) => ruleSection(r, i.nowMs)),
    actions: {
      buttons: [{ label: 'Open reliability page', url: dashboardUrl(`/projects/${encodeURIComponent(i.project)}/reliability`) }],
      run: [`emit-infra status ${i.project}`],
    },
    footerNote: 'Sent because alert rules fired. Each rule has a 6h cooldown before it can fire again.',
    sentAtMs: i.nowMs,
  })
  return { subject: subjectFor(i), html, text }
}
