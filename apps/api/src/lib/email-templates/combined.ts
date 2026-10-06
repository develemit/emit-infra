import { escapeHtml as e } from './escape.js'
import { TONE_COLOR, type Tone } from './layout.js'
import type { RenderedEmail } from './types.js'

export interface OutboxEmail extends RenderedEmail {
  tone: Tone
}

const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, recovered: 2, info: 3 }
const TONE_EMOJI: Record<Tone, string> = { critical: '🔴', warning: '🟠', recovered: '🟢', info: '🔵' }
const MAX_SUBJECT = 120

export function sortWorstFirst<T extends { tone: Tone }>(items: T[]): T[] {
  return [...items].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
}

// Per-item subjects look like "[emit-infra] 🔴 tastease DOWN — …"; keep only the first clause.
function subjectBlurb(subject: string): string {
  const stripped = subject.replace(/^\[emit-infra\]\s*\S+\s*/u, '')
  return stripped.split(/\s[—-]\s/u)[0] ?? stripped
}

function combinedSubject(sorted: OutboxEmail[]): string {
  const head = `[emit-infra] ${TONE_EMOJI[sorted[0]!.tone]} ${sorted.length} alerts — `
  let body = sorted.map((s) => subjectBlurb(s.subject)).join(', ')
  if (head.length + body.length > MAX_SUBJECT) body = `${body.slice(0, MAX_SUBJECT - head.length - 1).trimEnd()}…`
  return head + body
}

function bodyOf(html: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
  const inner = m?.[1] ?? html
  return inner.replace(/<span style="display:none[^>]*>[\s\S]*?<\/span>/, '')
}

export function renderCombinedEmail(items: OutboxEmail[]): OutboxEmail {
  const sorted = sortWorstFirst(items)
  const tone = sorted[0]!.tone
  const subject = combinedSubject(sorted)
  const sections = sorted
    .map((s) => `<div style="margin-top:12px;">${bodyOf(s.html)}</div>`)
    .join('')
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:${TONE_COLOR[tone]};padding:12px 24px;color:#ffffff;font-size:13px;font-weight:700;">${e(`${sorted.length} alerts in one email`)}</div>` +
    sections +
    `</body></html>`
  const rule = '\n\n' + '='.repeat(40) + '\n\n'
  const text = `${sorted.length} alerts in one email${rule}${sorted.map((s) => s.text).join(rule)}`
  return { subject, html, text, tone }
}
