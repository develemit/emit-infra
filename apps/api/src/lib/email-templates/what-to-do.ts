import { escapeHtml as e } from './escape.js'
import type { Remediation, Step, Urgency } from '../remediation/index.js'

export interface StepsSection {
  title: string
  kind: 'steps'
  urgency: Urgency
  steps: Step[]
}

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
const BADGE: Record<Urgency, { label: string; color: string }> = {
  now: { label: 'DO NOW', color: '#dc2626' },
  soon: { label: 'DO SOON', color: '#d97706' },
  watch: { label: 'KEEP AN EYE ON IT', color: '#2563eb' },
  none: { label: 'NO ACTION NEEDED', color: '#16a34a' },
}

export const firstStepOf = (rems: Remediation[]): { firstStep: string } | Record<string, never> => {
  const text = rems.find((r) => r.urgency !== 'none' && r.steps.length > 0)?.steps[0]?.text
  return text ? { firstStep: text } : {}
}

export const urgencyLabel = (u: Urgency): string => BADGE[u].label

export function renderWhatToDo(r: Remediation, title = 'What to do'): StepsSection {
  return { title, kind: 'steps', urgency: r.urgency, steps: r.steps }
}

function stepHtml(s: Step): string {
  const command = s.command
    ? `<div style="margin-top:4px;"><code style="font-family:${MONO};font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;color:#111827;word-break:break-all;">${e(s.command)}</code></div>`
    : ''
  const link = s.link ? `<div style="margin-top:4px;font-size:12px;color:#6b7280;">See ${e(s.link)}</div>` : ''
  return `<li style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#111827;"><span>${e(s.text)}</span>${command}${link}</li>`
}

export function renderStepsHtml(s: StepsSection): string {
  const badge = BADGE[s.urgency]
  const title = `<h3 style="margin:24px 0 8px;font-size:14px;color:#111827;">${e(s.title)} <span style="font-size:11px;font-weight:700;letter-spacing:.5px;color:${badge.color};">${badge.label}</span></h3>`
  return `${title}<ol style="margin:0;padding-left:20px;">${s.steps.map(stepHtml).join('')}</ol>`
}

export function renderStepsText(s: StepsSection): string[] {
  const out = [`[${urgencyLabel(s.urgency)}]`]
  s.steps.forEach((st, i) => {
    out.push(`${i + 1}. ${st.text}`)
    if (st.command) out.push(`   $ ${st.command}`)
    if (st.link) out.push(`   See ${st.link}`)
  })
  return out
}
