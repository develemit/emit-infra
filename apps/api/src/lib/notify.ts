/**
 * Single dispatcher for every alert: Web Push always, email when the alert
 * warrants it. Never throws.
 *
 * Email goes through develemail, which is itself a fleet server. If it is down,
 * email about develemail can't be delivered — push stays a channel for that
 * reason, and emit-vision pulse checks are the independent path.
 */

import { sendToAll, type PushPayload } from './push.js'
import type { EmailResult } from './email.js'
import { getOutbox, type QueuedResult } from './email-outbox.js'
import type { Tone } from './email-templates/layout.js'
import { renderLayout } from './email-templates/layout.js'
import { dashboardUrl } from './email-templates/format.js'
import type { RenderedEmail } from './email-templates/types.js'

export interface NotifyPayload extends PushPayload {
  severity: 'info' | 'alert'
  /** Pre-rendered email; sent even for `info` severity. */
  email?: RenderedEmail
}

export interface NotifyResult {
  push: { sent: number; pruned: number; error?: string }
  email: EmailResult | QueuedResult | { ok: false; error: 'skipped' }
}

const TONE_BY_SEVERITY = { alert: 'warning', info: 'info' } as const

const PUSH_BODY_MAX = 200

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

/** Shortens the body, not the step: the step is what makes the notification actionable. */
export function withFirstStep(body: string, firstStep?: string): string {
  if (!firstStep) return body
  const step = clip(firstStep, PUSH_BODY_MAX - 40)
  return `${clip(body, PUSH_BODY_MAX - step.length - 3)} → ${step}`
}

const toneOf = (p: NotifyPayload): Tone => p.email?.tone ?? TONE_BY_SEVERITY[p.severity]

function buildEmail(p: NotifyPayload): RenderedEmail {
  if (p.email) return p.email
  const link = p.url ? dashboardUrl(p.url) : undefined
  const { html, text } = renderLayout({
    tone: TONE_BY_SEVERITY[p.severity],
    preheader: p.body,
    headline: p.title,
    summary: p.body,
    facts: [],
    actions: link ? { buttons: [{ label: 'Open in dashboard', url: link }] } : {},
    footerNote: `Sent by emit-infra (${p.severity}).`,
  })
  return { subject: `[emit-infra] ${p.title}`, html, text }
}

export async function notify(payload: NotifyPayload): Promise<NotifyResult> {
  const { severity, email, ...rest } = payload
  const pushPayload: PushPayload = { title: rest.title, body: withFirstStep(rest.body, email?.firstStep), ...(rest.url !== undefined && { url: rest.url }), ...(rest.tag !== undefined && { tag: rest.tag }) }
  const wantsEmail = severity === 'alert' || email !== undefined

  const [push, mail] = await Promise.all([
    sendToAll(pushPayload).catch((err: unknown) => ({
      sent: 0,
      pruned: 0,
      error: err instanceof Error ? err.message : String(err),
    })),
    wantsEmail
      ? getOutbox().enqueue(buildEmail(payload), toneOf(payload)).catch(
          (err: unknown): EmailResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        )
      : Promise.resolve({ ok: false, error: 'skipped' } as const),
  ])
  return { push, email: mail }
}
