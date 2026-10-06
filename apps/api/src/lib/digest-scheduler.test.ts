import { describe, it, expect, vi } from 'vitest'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('./notify.js', () => ({ notify }))
vi.mock('./discover-projects.js', () => ({ discoverProjects: vi.fn() }))
vi.mock('./incidents.js', () => ({ readLastIncident: vi.fn() }))

import { dispatchDigest } from './digest-scheduler.js'

describe('dispatchDigest', () => {
  it('notifies at info severity with the digest email naming each project', async () => {
    notify.mockResolvedValue({})
    await dispatchDigest([
      { project: 'alpha', incidents: [], deploys: [], diskPctNow: undefined, diskPctWeekAgo: undefined },
      { project: 'beta', incidents: [], deploys: [], diskPctNow: undefined, diskPctWeekAgo: undefined },
    ])
    const arg = notify.mock.calls[0]![0]
    expect(arg.severity).toBe('info')
    expect(arg.tag).toBe('weekly-digest')
    expect(arg.email.subject).toContain('Weekly fleet digest')
    expect(arg.email.html).toContain('alpha')
    expect(arg.email.html).toContain('beta')
  })
})
