import { DevelEmail } from '@develemail/sdk'

export type EmailResult = { ok: true } | { ok: false; error: string; retryable?: boolean }

export interface EmailInput {
  subject: string
  html: string
  text: string
}

let client: DevelEmail | null = null

function getClient(): DevelEmail | null {
  const apiKey = process.env['DEVELEMAIL_API_KEY']
  const baseUrl = process.env['DEVELEMAIL_BASE_URL']
  if (!apiKey || !baseUrl) return null
  client ??= new DevelEmail({ apiKey, baseUrl, maxRetries: 0 })
  return client
}

// develemail answers a recipient cooldown with 429; its SDK retry reuses the Idempotency-Key and
// turns that into a misleading 409 "currently being processed". Treat all of them as cooldown.
export function isCooldownError(message: string): boolean {
  return /idempotency|429|cooldown|too many/i.test(message)
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const from = process.env['ALERT_EMAIL_FROM']
  const to = process.env['ALERT_EMAIL_TO'] ?? 'emitdutcher@gmail.com'
  const c = getClient()
  if (!c || !from) return { ok: false, error: 'not configured' }
  try {
    const res = await c.emails.send({ from, to, ...input })
    if ((res as { duplicate?: boolean }).duplicate) return { ok: false, error: 'duplicate', retryable: true }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return isCooldownError(error) ? { ok: false, error, retryable: true } : { ok: false, error }
  }
}

export function resetEmailClientForTests(): void {
  client = null
}
