/**
 * Single dispatcher for every alert: Web Push always, email when the alert
 * warrants it. Never throws.
 *
 * Email goes through develemail, which is itself a fleet server. If it is down,
 * email about develemail can't be delivered — push stays a channel for that
 * reason, and emit-vision pulse checks are the independent path.
 */

import { sendToAll, type PushPayload } from './push.js'
import { sendEmail, type EmailResult } from './email.js'

export interface NotifyPayload extends PushPayload {
  severity: 'info' | 'alert'
  email?: boolean
  emailHtml?: string
}

export interface NotifyResult {
  push: { sent: number; pruned: number; error?: string }
  email: EmailResult | { ok: false; error: 'skipped' }
}

const DEFAULT_DASHBOARD_ORIGIN = 'http://localhost:7013'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function resolveUrl(url: string): string {
  const origin = process.env['DASHBOARD_ORIGIN'] ?? DEFAULT_DASHBOARD_ORIGIN
  try {
    return new URL(url, origin).toString()
  } catch {
    return url
  }
}

function buildEmail(p: NotifyPayload): { subject: string; html: string; text: string } {
  const link = p.url ? resolveUrl(p.url) : undefined
  const html =
    p.emailHtml ??
    `<h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.body)}</p>` +
      (link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : '')
  const text = `${p.title}\n\n${p.body}${link ? `\n\n${link}` : ''}`
  return { subject: `[emit-infra] ${p.title}`, html, text }
}

export async function notify(payload: NotifyPayload): Promise<NotifyResult> {
  const { severity, email, ...rest } = payload
  const pushPayload: PushPayload = { title: rest.title, body: rest.body, ...(rest.url !== undefined && { url: rest.url }), ...(rest.tag !== undefined && { tag: rest.tag }) }
  const wantsEmail = severity === 'alert' || email === true

  const [push, mail] = await Promise.all([
    sendToAll(pushPayload).catch((err: unknown) => ({
      sent: 0,
      pruned: 0,
      error: err instanceof Error ? err.message : String(err),
    })),
    wantsEmail
      ? sendEmail(buildEmail(payload)).catch(
          (err: unknown): EmailResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        )
      : Promise.resolve({ ok: false, error: 'skipped' } as const),
  ])
  return { push, email: mail }
}
