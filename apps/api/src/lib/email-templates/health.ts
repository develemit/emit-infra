import { causeText, formatDuration, REMINDER_INTERVAL_MS } from '../http-health.js'
import { renderLayout, type Section, type Tone } from './layout.js'
import { dashboardUrl, formatTime } from './format.js'
import type { RenderedEmail } from './types.js'

export interface HealthEmailInput {
  kind: 'down' | 'reminder' | 'up'
  check: 'ssh' | 'http'
  project: string
  serverIp?: string
  url?: string
  status?: number
  downSinceMs: number
  durationMs: number
  lastGoodMs?: number
  incidents7d: Array<{ atMs: number; durationMs?: number; cause?: string }>
  nowMs: number
}

function causeLine(i: HealthEmailInput): string {
  if (i.check === 'ssh') return 'SSH unreachable'
  return i.status !== undefined ? `${causeText(i.status)} (HTTP ${i.status})` : causeText(undefined)
}

function subjectFor(i: HealthEmailInput): string {
  const short = i.check === 'ssh' ? 'SSH unreachable' : i.status !== undefined ? `HTTP ${i.status}` : 'no response'
  if (i.kind === 'up') return `[emit-infra] 🟢 ${i.project} recovered after ${formatDuration(i.durationMs)}`
  if (i.kind === 'reminder') return `[emit-infra] 🔴 ${i.project} still DOWN (${formatDuration(i.durationMs)}) — ${short}`
  return `[emit-infra] 🔴 ${i.project} DOWN — ${short}`
}

function incidentSection(i: HealthEmailInput): Section | undefined {
  if (i.incidents7d.length === 0) return undefined
  return {
    title: `Incidents in the last 7 days (${i.incidents7d.length})`,
    kind: 'table',
    head: ['When', 'Duration', 'Cause'],
    rows: i.incidents7d.map((x) => [
      formatTime(x.atMs, i.nowMs),
      x.durationMs !== undefined ? formatDuration(x.durationMs) : 'ongoing',
      x.cause ?? '—',
    ]),
  }
}

export function renderHealthEmail(i: HealthEmailInput): RenderedEmail {
  const recovered = i.kind === 'up'
  const tone: Tone = recovered ? 'recovered' : 'critical'
  const duration = formatDuration(i.durationMs)
  const checkLabel = i.check === 'ssh' ? 'SSH' : 'HTTP health check'
  const headline = recovered ? `${i.project} is back up` : `${i.project} is down`
  const summary = recovered
    ? `${checkLabel} is passing again after ${duration} of downtime.`
    : i.kind === 'reminder'
      ? `Still down after ${duration}. Cause: ${causeLine(i)}.`
      : `${checkLabel} failed 3 checks in a row. Cause: ${causeLine(i)}.`

  const facts: Array<[string, string]> = [['Project', i.project]]
  if (i.serverIp) facts.push(['Server IP', i.serverIp])
  facts.push(['Check', i.check === 'ssh' ? 'SSH' : 'HTTP'])
  if (i.url) facts.push(['URL', i.url])
  facts.push(['Cause', causeLine(i)])
  if (i.status !== undefined) facts.push(['HTTP status', String(i.status)])
  facts.push(['Down since', formatTime(i.downSinceMs, i.nowMs)])
  facts.push([recovered ? 'Total downtime' : 'Duration', duration])
  if (i.lastGoodMs !== undefined) facts.push(['Last good check', formatTime(i.lastGoodMs, i.nowMs)])

  const incidents = incidentSection(i)
  const { html, text } = renderLayout({
    tone,
    preheader: recovered ? `Back up after ${duration}` : `${causeLine(i)} — down ${duration}`,
    headline,
    summary,
    facts,
    ...(incidents && { sections: [incidents] }),
    actions: {
      buttons: [{ label: 'Open in dashboard', url: dashboardUrl(`/projects/${encodeURIComponent(i.project)}`) }],
      run: recovered ? [`emit-infra status ${i.project}`] : [`emit-infra status ${i.project}`, '/triage-prod'],
    },
    footerNote: recovered
      ? `Sent because ${i.project} recovered. No further reminders.`
      : `Sent because ${i.project} is down. Next reminder in ${formatDuration(REMINDER_INTERVAL_MS)} if still down.`,
    sentAtMs: i.nowMs,
  })
  return { subject: subjectFor(i), html, text }
}

