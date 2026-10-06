import { renderLayout, type Cell } from './layout.js'
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

function disk(r: DigestProjectRow): Cell {
  if (r.diskPct === undefined) return '—'
  const delta = r.diskDeltaPct ? ` (${r.diskDeltaPct > 0 ? '+' : ''}${r.diskDeltaPct})` : ''
  const text = `${Math.round(r.diskPct)}%${delta}`
  return r.diskPct >= 90 ? { text, tint: 'red' } : r.diskPct >= 80 ? { text, tint: 'amber' } : text
}

function cert(r: DigestProjectRow): Cell {
  if (r.certDays === undefined) return '—'
  const text = `${Math.round(r.certDays)}d`
  return r.certDays < 7 ? { text, tint: 'red' } : r.certDays < 21 ? { text, tint: 'amber' } : text
}

function backup(r: DigestProjectRow): Cell {
  if (r.backupAgeHours === undefined) return '—'
  const text = r.backupAgeHours >= 48 ? `${Math.round(r.backupAgeHours / 24)}d` : `${Math.round(r.backupAgeHours)}h`
  return r.backupAgeHours > 36 ? { text, tint: r.backupAgeHours > 72 ? 'red' : 'amber' } : text
}

export function renderDigestEmail(i: DigestEmailInput): RenderedEmail {
  const incidents = i.projects.reduce((n, p) => n + p.incidents, 0)
  const rows: Cell[][] = i.projects.map((p) => [
    `${DOT[p.status]} ${p.project}`,
    p.incidents > 0 ? { text: String(p.incidents), tint: 'amber' } : '0',
    String(p.deploys),
    disk(p),
    cert(p),
    backup(p),
  ])
  const { html, text } = renderLayout({
    tone: incidents > 0 ? 'warning' : 'info',
    preheader: i.summaryLine,
    headline: 'Weekly fleet digest',
    summary: i.summaryLine,
    facts: [
      ['Projects', String(i.projects.length)],
      ['Incidents', String(incidents)],
      ['Deploys', String(i.projects.reduce((n, p) => n + p.deploys, 0))],
    ],
    sections: [{ title: 'Per project', kind: 'table', head: ['Project', 'Incidents', 'Deploys', 'Disk', 'Cert', 'Backup'], rows }],
    actions: { buttons: [{ label: 'Open dashboard', url: dashboardUrl('/') }] },
    footerNote: 'Sent weekly. Amber and red values are outside healthy ranges.',
    sentAtMs: i.nowMs,
  })
  return { subject: `[emit-infra] 📊 Weekly fleet digest — ${plural(i.projects.length, 'project')}, ${plural(incidents, 'incident')}`, html, text, tone: incidents > 0 ? 'warning' : 'info' }
}
