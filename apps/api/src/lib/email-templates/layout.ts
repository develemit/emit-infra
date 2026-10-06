import { escapeHtml as e } from './escape.js'
import { formatTime } from './format.js'

export type Tone = 'critical' | 'warning' | 'recovered' | 'info'
export type Tint = 'red' | 'amber' | 'green'
export type Cell = string | { text: string; tint: Tint }

export type Section =
  | { title: string; kind: 'list'; rows: Array<[string, string]> }
  | { title: string; kind: 'table'; head: string[]; rows: Cell[][] }
  | { title: string; kind: 'pre'; text: string }

export interface LayoutInput {
  tone: Tone
  preheader: string
  headline: string
  summary: string
  facts: Array<[string, string]>
  sections?: Section[]
  actions: { buttons?: Array<{ label: string; url: string }>; run?: string[] }
  footerNote: string
  sentAtMs?: number
}

export const TONE_COLOR: Record<Tone, string> = {
  critical: '#dc2626',
  warning: '#d97706',
  recovered: '#16a34a',
  info: '#2563eb',
}
const TINT_COLOR: Record<Tint, string> = { red: '#dc2626', amber: '#d97706', green: '#16a34a' }
const TONE_LABEL: Record<Tone, string> = { critical: 'CRITICAL', warning: 'WARNING', recovered: 'RECOVERED', info: 'INFO' }
export const MAX_PRE_LINES = 40
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

export function truncateLines(text: string, max = MAX_PRE_LINES): string {
  const lines = text.split('\n')
  return lines.length <= max ? text : [...lines.slice(0, max), '…truncated'].join('\n')
}

const cellText = (c: Cell): string => (typeof c === 'string' ? c : c.text)

function renderCell(c: Cell, tag: 'td' | 'th'): string {
  const color = typeof c === 'string' ? '' : `color:${TINT_COLOR[c.tint]};font-weight:600;`
  return `<${tag} style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:13px;${color}">${e(cellText(c))}</${tag}>`
}

function renderSection(s: Section): string {
  const title = `<h3 style="margin:24px 0 8px;font-size:14px;color:#111827;">${e(s.title)}</h3>`
  if (s.kind === 'pre') {
    return `${title}<pre style="margin:0;padding:12px;background:#f3f4f6;border-radius:6px;font-family:${MONO};font-size:12px;white-space:pre-wrap;word-break:break-word;color:#111827;">${e(truncateLines(s.text))}</pre>`
  }
  if (s.kind === 'list') return title + factsTable(s.rows)
  const head = `<tr>${s.head.map((h) => renderCell(h, 'th')).join('')}</tr>`
  const body = s.rows.map((r) => `<tr>${r.map((c) => renderCell(c, 'td')).join('')}</tr>`).join('')
  return `${title}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${head}${body}</table>`
}

function factsTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td width="140" style="width:140px;padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;">${e(k)}</td>` +
        `<td style="padding:6px 0;color:#111827;font-size:13px;">${e(v)}</td></tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body}</table>`
}

function renderActions(a: LayoutInput['actions'], color: string): string {
  const buttons = (a.buttons ?? [])
    .slice(0, 3)
    .map(
      (b) =>
        `<td style="padding-right:8px;"><a href="${e(b.url)}" style="display:inline-block;padding:10px 16px;background:${color};color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">${e(b.label)}</a></td>`,
    )
    .join('')
  const row = buttons ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:20px;"><tr>${buttons}</tr></table>` : ''
  const run = (a.run ?? [])
    .map((c) => `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Run: <code style="font-family:${MONO};background:#f3f4f6;padding:2px 6px;border-radius:4px;color:#111827;">${e(c)}</code></div>`)
    .join('')
  return row + run
}

function renderText(i: LayoutInput, sentAt: string): string {
  const out = [`${TONE_LABEL[i.tone]}: ${i.headline}`, '', i.summary, '']
  for (const [k, v] of i.facts) out.push(`${k}: ${v}`)
  for (const s of i.sections ?? []) {
    out.push('', s.title.toUpperCase())
    if (s.kind === 'list') for (const [k, v] of s.rows) out.push(`${k}: ${v}`)
    else if (s.kind === 'pre') out.push(truncateLines(s.text))
    else {
      out.push(s.head.join(' | '))
      for (const r of s.rows) out.push(r.map(cellText).join(' | '))
    }
  }
  const { buttons = [], run = [] } = i.actions
  if (buttons.length || run.length) out.push('')
  for (const b of buttons.slice(0, 3)) out.push(`${b.label}: ${b.url}`)
  for (const c of run) out.push(`Run: ${c}`)
  out.push('', `${sentAt} — ${i.footerNote}`)
  return out.join('\n')
}

export function renderLayout(i: LayoutInput): { html: string; text: string } {
  const color = TONE_COLOR[i.tone]
  const nowMs = i.sentAtMs ?? Date.now()
  const sentAt = formatTime(nowMs, nowMs)
  const sections = (i.sections ?? []).map(renderSection).join('')
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT};">` +
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(i.preheader)}</span>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:${color};padding:10px 24px;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:1px;">${TONE_LABEL[i.tone]}</td></tr>` +
    `<tr><td style="padding:24px;">` +
    `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#111827;">${e(i.headline)}</h1>` +
    `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#374151;">${e(i.summary)}</p>` +
    factsTable(i.facts) +
    sections +
    renderActions(i.actions, color) +
    `</td></tr>` +
    `<tr><td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:11px;line-height:1.5;">${e(sentAt)} — ${e(i.footerNote)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  return { html, text: renderText(i, sentAt) }
}
