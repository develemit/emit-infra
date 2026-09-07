import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {}, invalidate: () => {} }),
}))

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
  ProjectConfigSchema: { safeParse: vi.fn() },
  classifyRunState: vi.fn().mockReturnValue({
    state: 'unknown',
    reason: 'stub',
    heartbeatAgeSec: null,
    pidAlive: null,
    sameHost: null,
  }),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { readFile } from 'node:fs/promises'
import { projectStatusRoutes } from './project-status.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: '1.2.3.4',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('status poll logging is quiet about by-design conditions', () => {
  let app: FastifyInstance
  let warn: ReturnType<typeof vi.spyOn>
  let info: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.mocked(discoverProjects).mockResolvedValue([mockProject] as never)
    vi.mocked(sshExec).mockResolvedValue('up 5 days, 3 hours\n42%\n60\n3')
    app = Fastify({ logger: false })
    await app.register(projectStatusRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    warn.mockRestore()
    info.mockRestore()
    vi.unstubAllGlobals()
  })

  // Regression: the test-smoke fixture has no .deploy-history.jsonl (it has
  // never deployed, by design), and every 60s poll logged that as a failure.
  it('does not warn when .deploy-history.jsonl is simply absent (ENOENT)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    vi.mocked(readFile).mockRejectedValue(enoent)

    await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(lines).not.toContain('[lastDeployEpoch]')
  })

  it('still warns when the history file exists but is unreadable for another reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    vi.mocked(readFile).mockRejectedValue(denied)

    await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(lines).toContain('[lastDeployEpoch]')
  })
})

describe('HTTP check tolerates a transient stall before declaring a site down', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(discoverProjects).mockResolvedValue([mockProject] as never)
    vi.mocked(sshExec).mockResolvedValue('up 5 days, 3 hours\n42%\n60\n3')
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )
    app = Fastify({ logger: false })
    await app.register(projectStatusRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
  })

  // Regression: one slow probe used to yield httpStatus null, which the
  // dashboard renders as "Down" — 5 of 7 healthy projects flapped to Down on
  // 2026-08-27 purely from a 5s timeout on a loaded machine.
  it('retries once and reports the real status when the first probe fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('TimeoutError: aborted'))
      .mockResolvedValueOnce({ status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.json().httpStatus).toBe(200)
  })

  it('still reports null when every attempt fails, so a real outage surfaces', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.json().httpStatus).toBeNull()
  })

  // Regression: test-smoke's domain is an RFC 5737 TEST-NET-1 address,
  // unroutable by design — probing it wastes a fetch and produced steady log
  // noise (22 TimeoutError + 19 TypeError lines for one such fixture).
  it('never fetches a domain in an RFC 5737 reserved range', async () => {
    const fixtureProject = { ...mockProject, config: { ...mockProject.config, domain: '192.0.2.1' } }
    vi.mocked(discoverProjects).mockResolvedValue([fixtureProject] as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.json().httpStatus).toBeNull()
  })
})
