import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notify, incidentsLast7d, writeIncident } = vi.hoisted(() => ({
  notify: vi.fn(),
  incidentsLast7d: vi.fn(),
  writeIncident: vi.fn(),
}))
vi.mock('./notify.js', () => ({ notify }))
vi.mock('./email-context.js', () => ({ incidentsLast7d }))
vi.mock('./incidents.js', () => ({ writeIncident, readLastIncident: vi.fn() }))
vi.mock('./discover-projects.js', () => ({ discoverProjects: vi.fn() }))

import { handleHealthEvents } from './health-notify.js'

const NOW = 1_800_000_000_000

beforeEach(() => {
  notify.mockReset().mockResolvedValue({})
  incidentsLast7d.mockReset().mockResolvedValue([])
  writeIncident.mockReset()
})

describe('handleHealthEvents', () => {
  it('down notifies at alert severity with the health email', async () => {
    await handleHealthEvents('http', 'app', [{ kind: 'down', status: 502 }], { serverIp: '1.2.3.4', url: 'https://app.test', nowMs: NOW })
    const arg = notify.mock.calls[0]![0]
    expect(arg.severity).toBe('alert')
    expect(arg.tag).toBe('http-down:app')
    expect(arg.email.subject).toBe('[emit-infra] 🔴 app DOWN — HTTP 502')
    expect(arg.email.text).toContain('1.2.3.4')
  })

  it('up notifies at alert severity with a recovery email', async () => {
    await handleHealthEvents('ssh', 'app', [{ kind: 'up', downDurationMs: 120_000 }], { nowMs: NOW })
    const arg = notify.mock.calls[0]![0]
    expect(arg.severity).toBe('alert')
    expect(arg.tag).toBe('up:app')
    expect(arg.email.subject).toContain('recovered after')
  })

  it('reminder notifies at alert severity and is not written as an incident', async () => {
    await handleHealthEvents('ssh', 'app', [{ kind: 'reminder', status: undefined, downDurationMs: 6 * 3600_000 }], { nowMs: NOW })
    expect(notify.mock.calls[0]![0].severity).toBe('alert')
    expect(writeIncident).not.toHaveBeenCalled()
  })

  it('still notifies, without an email, when rendering fails', async () => {
    incidentsLast7d.mockRejectedValue(new Error('boom'))
    await handleHealthEvents('ssh', 'app', [{ kind: 'down', status: undefined }], { nowMs: NOW })
    const arg = notify.mock.calls[0]![0]
    expect(arg.severity).toBe('alert')
    expect(arg.email).toBeUndefined()
  })
})
