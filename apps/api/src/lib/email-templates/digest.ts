import { remediate, type Urgency } from '../remediation/index.js'
import { renderLayout, type Cell, type Section, type Tone } from './layout.js'
import { attentionItems, findingsFor, tintFor, worstUrgency } from './digest-attention.js'
import { renderWhatToDo, urgencyLabel } from './what-to-do.js'
import { dashboardUrl, plural } from './format.js'
import type { RenderedEmail } from './types.js'

export interface DigestProjectRow {
  project: string
  status: 'up' | 'down' | 'unknown'
  incidents: number
  deploys: number
  diskPct?: number
  diskDeltaPct?: number
  certDays?: number
  backupAgeHours?: number
}

export interface DigestEmailInput {
  summaryLine: string
  projects: DigestProjectRow[]
  nowMs: number
}

const DOT = { up: '🟢', down: '🔴', unknown: '⚪' } as const

function tinted(text: string, urgency: Urgency): Cell {
  const tint = tintFor(urgency)
  return tint ? { text, tint } : text
}

function disk(r: DigestProjectRow): Cell {
  if (r.diskPct === undefined) return '—'
  const delta = r.diskDeltaPct ? ` (${r.diskDeltaPct > 0 ? '+' : ''}${r.diskDeltaPct})` : ''
  const text = `${Math.round(r.diskPct)}%${delta}`
  return tinted(text, remediate({ project: r.project, kind: 'disk', pct: r.diskPct }).urgency)
}

function cert(r: DigestProjectRow): Cell {
  if (r.certDays === undefined) return '—'
  const text = `${Math.round(r.certDays)}d`
  return tinted(text, remediate({ project: r.project, kind: 'cert', daysLeft: r.certDays }).urgency)
}

function backup(r: DigestProjectRow): Cell {
  if (r.backupAgeHours === undefined) return '—'
  const text = r.backupAgeHours >= 48 ? `${Math.round(r.backupAgeHours / 24)}d` : `${Math.round(r.backupAgeHours)}h`
  return tinted(text, remediate({ project: r.project, kind: 'backup', ageHours: r.backupAgeHours }).urgency)
}

const HEALTHY = 'Nothing needs attention this week.'

function toneFor(worst: Urgency): Tone {
  return worst === 'now' ? 'critical' : worst === 'none' ? 'recovered' : 'warning'
}

function attentionSection(items: ReturnType<typeof attentionItems>): Section {
  if (items.length === 0) return { title: 'Needs attention', kind: 'pre', text: `✅ ${HEALTHY}` }
  return {
    title: 'Needs attention',
    kind: 'table',
    head: ['Project', 'Finding', 'First step', 'When'],
    rows: items.map((it): Cell[] => {
      const tint = tintFor(it.urgency)
      const when = urgencyLabel(it.urgency)
      return [it.project, it.headline, it.steps[0]?.text ?? '—', tint ? { text: when, tint } : when]
    }),
  }
}

export function renderDigestEmail(i: DigestEmailInput): RenderedEmail {
  const incidents = i.projects.reduce((n, p) => n + p.incidents, 0)
  const items = attentionItems(i.projects)
  const tone = toneFor(worstUrgency(items))
  const rows: Cell[][] = i.projects.map((p) => [
    `${DOT[p.status]} ${p.project}`,
    p.incidents > 0 ? { text: String(p.incidents), tint: 'amber' } : '0',
    String(p.deploys),
    disk(p),
    cert(p),
    backup(p),
  ])
  const todo = i.projects.flatMap((p) =>
    findingsFor(p).flatMap((f) => {
      const rem = remediate(f)
      return rem.steps.length > 0 ? [renderWhatToDo(rem, `${p.project}: ${rem.headline}`)] : []
    }),
  )
  const { html, text } = renderLayout({
    tone,
    ...(tone === 'recovered' && { toneLabel: 'ALL CLEAR' }),
    preheader: items.length === 0 ? HEALTHY : `${items.length} ${items.length === 1 ? 'item needs' : 'items need'} attention — ${i.summaryLine}`,
    headline: 'Weekly fleet digest',
    summary: i.summaryLine,
    facts: [
      ['Projects', String(i.projects.length)],
      ['Incidents', String(incidents)],
      ['Deploys', String(i.projects.reduce((n, p) => n + p.deploys, 0))],
    ],
    sections: [
      attentionSection(items),
      { title: 'Per project', kind: 'table', head: ['Project', 'Incidents', 'Deploys', 'Disk', 'Cert', 'Backup'], rows },
      ...todo,
    ],
    actions: { buttons: [{ label: 'Open dashboard', url: dashboardUrl('/') }] },
    footerNote: 'Sent weekly. Amber and red values need attention; steps for each are listed above.',
    sentAtMs: i.nowMs,
  })
  return { subject: `[emit-infra] 📊 Weekly fleet digest — ${plural(i.projects.length, 'project')}, ${plural(incidents, 'incident')}`, html, text, tone, ...(items[0]?.steps[0] && { firstStep: items[0].steps[0].text }) }
}
