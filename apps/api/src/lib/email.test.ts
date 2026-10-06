import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn()
vi.mock('@develemail/sdk', () => ({
  DevelEmail: vi.fn().mockImplementation(() => ({ emails: { send } })),
}))

import { sendEmail, resetEmailClientForTests } from './email.js'

const input = { subject: 's', html: '<p>h</p>', text: 't' }

describe('sendEmail', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('DEVELEMAIL_API_KEY', '')
    vi.stubEnv('DEVELEMAIL_BASE_URL', '')
    vi.stubEnv('ALERT_EMAIL_FROM', '')
    send.mockReset()
    resetEmailClientForTests()
  })

  it('returns not configured without throwing when env vars are absent', async () => {
    expect(await sendEmail(input)).toEqual({ ok: false, error: 'not configured' })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends via the client when configured', async () => {
    vi.stubEnv('DEVELEMAIL_API_KEY', 'k')
    vi.stubEnv('DEVELEMAIL_BASE_URL', 'https://mail.example')
    vi.stubEnv('ALERT_EMAIL_FROM', 'alerts@example.com')
    send.mockResolvedValue({ id: '1', status: 'queued' })
    expect(await sendEmail(input)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'alerts@example.com', to: 'emitdutcher@gmail.com' }))
  })

  it('converts client errors into a result', async () => {
    vi.stubEnv('DEVELEMAIL_API_KEY', 'k')
    vi.stubEnv('DEVELEMAIL_BASE_URL', 'https://mail.example')
    vi.stubEnv('ALERT_EMAIL_FROM', 'alerts@example.com')
    send.mockRejectedValue(new Error('boom'))
    expect(await sendEmail(input)).toEqual({ ok: false, error: 'boom' })
  })

  describe('retryable classification', () => {
    beforeEach(() => {
      vi.stubEnv('DEVELEMAIL_API_KEY', 'k')
      vi.stubEnv('DEVELEMAIL_BASE_URL', 'https://mail.example')
      vi.stubEnv('ALERT_EMAIL_FROM', 'alerts@example.com')
    })

    it.each(['HTTP 429 Too Many Requests', 'idempotency key is currently being processed', 'recipient cooldown active'])('flags %s', async (msg) => {
      send.mockRejectedValue(new Error(msg))
      expect(await sendEmail(input)).toEqual({ ok: false, error: msg, retryable: true })
    })

    it('flags duplicate responses', async () => {
      send.mockResolvedValue({ id: '1', status: 'queued', duplicate: true })
      expect(await sendEmail(input)).toEqual({ ok: false, error: 'duplicate', retryable: true })
    })

    it('does not flag other errors', async () => {
      send.mockRejectedValue(new Error('boom'))
      expect(await sendEmail(input)).toEqual({ ok: false, error: 'boom' })
    })
  })
})
