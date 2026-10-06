import { DevelEmail } from '@develemail/sdk'

export type EmailResult = { ok: true } | { ok: false; error: string }

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
  client ??= new DevelEmail({ apiKey, baseUrl })
  return client
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const from = process.env['ALERT_EMAIL_FROM']
  const to = process.env['ALERT_EMAIL_TO'] ?? 'emitdutcher@gmail.com'
  const c = getClient()
  if (!c || !from) return { ok: false, error: 'not configured' }
  try {
    await c.emails.send({ from, to, ...input })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function resetEmailClientForTests(): void {
  client = null
}
