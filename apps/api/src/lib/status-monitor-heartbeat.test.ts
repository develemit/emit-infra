import { afterEach, describe, expect, it, vi } from 'vitest'

async function runPoll(projects: unknown[]) {
  vi.resetModules()
  const pingPulse = vi.fn().mockResolvedValue(true)
  vi.doMock('@emit-infra/core', () => ({ sshExec: vi.fn().mockRejectedValue(new Error('down')) }))
  vi.doMock('./notify.js', () => ({ notify: vi.fn() }))
  vi.doMock('./health-notify.js', () => ({ handleHealthEvents: vi.fn(), seedHealthMaps: vi.fn() }))
  vi.doMock('./pulse.js', () => ({ pingPulse, warnIfPulseUnconfigured: vi.fn() }))
  vi.doMock('./discover-projects.js', () => ({ discoverProjects: async () => projects }))
  const { poll } = await import('./status-monitor.js')
  await poll()
  return pingPulse
}

afterEach(() => {
  for (const m of ['@emit-infra/core', './notify.js', './health-notify.js', './pulse.js', './discover-projects.js']) vi.doUnmock(m)
})

describe('poll — heartbeat', () => {
  it('pings success after a poll with projects', async () => {
    const pingPulse = await runPoll([{ config: { name: 'test-smoke', domain: '192.0.2.1' } }])
    expect(pingPulse).toHaveBeenCalledWith('emit-infra-monitor', { fail: false })
  })

  it('pings /fail when there are no projects', async () => {
    const pingPulse = await runPoll([])
    expect(pingPulse).toHaveBeenCalledWith('emit-infra-monitor', { fail: true })
  })
})
