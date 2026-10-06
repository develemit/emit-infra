import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendToAll, sendEmail } = vi.hoisted(() => ({ sendToAll: vi.fn(), sendEmail: vi.fn() }))
vi.mock('./push.js', () => ({ sendToAll }))
vi.mock('./email-outbox.js', () => ({ getOutbox: () => ({ enqueue: sendEmail }) }))

import { notify, withFirstStep } from './notify.js'

const base = { title: 'Cert expiring', body: 'in 5 days', url: '/health' }

describe('notify', () => {
  beforeEach(() => {
    sendToAll.mockReset().mockResolvedValue({ sent: 1, pruned: 0 })
    sendEmail.mockReset().mockResolvedValue({ ok: true })
  })

  it('alert severity pushes and emails', async () => {
    const r = await notify({ ...base, severity: 'alert' })
    expect(sendToAll).toHaveBeenCalledOnce()
    expect(sendEmail).toHaveBeenCalledOnce()
    expect(r).toEqual({ push: { sent: 1, pruned: 0 }, email: { ok: true } })
  })

  it('info severity pushes only', async () => {
    const r = await notify({ ...base, severity: 'info' })
    expect(sendToAll).toHaveBeenCalledOnce()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.email).toEqual({ ok: false, error: 'skipped' })
  })

  it('info with a structured email sends it verbatim, and strips notify-only fields from the push', async () => {
    const email = { subject: 'S', html: '<p>H</p>', text: 'T' }
    await notify({ ...base, severity: 'info', email })
    expect(sendEmail).toHaveBeenCalledWith(email, 'info')
    expect(sendToAll).toHaveBeenCalledWith(base)
  })

  it('falls back to renderLayout when no structured email is given', async () => {
    await notify({ ...base, severity: 'alert' })
    const arg = sendEmail.mock.calls[0]![0]
    expect(arg.subject).toBe('[emit-infra] Cert expiring')
    expect(arg.html).toContain('<!doctype html>')
    expect(arg.html).toContain('#d97706')
    expect(arg.text).toContain('WARNING: Cert expiring')
  })

  it('resolves the url against the dashboard origin in the email', async () => {
    await notify({ ...base, severity: 'alert' })
    const arg = sendEmail.mock.calls[0]![0]
    expect(arg.text).toContain('/health')
    expect(arg.html).toContain('http')
  })

  it('never rejects when email and push both throw', async () => {
    sendEmail.mockRejectedValue(new Error('mail down'))
    sendToAll.mockRejectedValue(new Error('push down'))
    const r = await notify({ ...base, severity: 'alert' })
    expect(r.email).toEqual({ ok: false, error: 'mail down' })
    expect(r.push).toMatchObject({ sent: 0, error: 'push down' })
  })
})

describe('withFirstStep', () => {
  it('appends the step to the body', () => {
    expect(withFirstStep('Disk at 91%', 'Prune old images')).toBe('Disk at 91% → Prune old images')
  })
  it('leaves the body alone without a step', () => {
    expect(withFirstStep('Disk at 91%')).toBe('Disk at 91%')
  })
  it('shortens a long body but keeps the step intact', () => {
    const out = withFirstStep('x'.repeat(400), 'Fix the error locally')
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('→ Fix the error locally')).toBe(true)
  })
  it('is sent through to push', async () => {
    sendToAll.mockResolvedValue({ sent: 1, pruned: 0 })
    sendEmail.mockResolvedValue({ ok: true })
    await notify({ severity: 'alert', title: 't', body: 'b', email: { subject: 's', html: '', text: '', firstStep: 'Do it' } })
    expect(sendToAll).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'b → Do it' }))
  })
})
