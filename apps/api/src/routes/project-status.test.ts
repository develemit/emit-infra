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
import { sshExec, classifyRunState } from '@emit-infra/core'
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

describe('GET /projects/:name/status', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))
    app = Fastify({ logger: false })
    await app.register(projectStatusRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/status' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 with error body when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 200 with parsed metrics when SSH succeeds', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('up 5 days, 3 hours\n42%\n60\n3')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.uptime).toBe('up 5 days, 3 hours')
    expect(data.disk).toBe(42)
    expect(data.memory).toBe(60)
    expect(data.containerCount).toBe(3)
  })

  it('skips the letsencrypt cert probe when domain is not a hostname', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('up 5 days')

    await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(vi.mocked(sshExec).mock.calls[0]?.[1]).not.toContain('letsencrypt')
  })

  it('probes the letsencrypt cert when domain is a valid hostname', async () => {
    const domainProject = { ...mockProject, config: { ...mockProject.config, domain: 'myapp.example.com' } }
    vi.mocked(discoverProjects).mockResolvedValue([domainProject])
    vi.mocked(sshExec).mockResolvedValue('up 5 days')

    await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(vi.mocked(sshExec).mock.calls[0]?.[1]).toContain('/etc/letsencrypt/live/myapp.example.com/')
  })

  it('omits numeric fields instead of sending NaN when SSH output is short', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('up 2 days')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/status' })

    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('NaN')
    const data = res.json()
    expect(data.uptime).toBe('up 2 days')
    expect(data.disk).toBeUndefined()
    expect(data.memory).toBeUndefined()
    expect(data.containerCount).toBeUndefined()
    expect(data.containerTotal).toBeUndefined()
    expect(data.containerUnhealthy).toBeUndefined()
  })
})

describe.each([
  ['ci-status', '.ci-status.json'],
  ['deploy-status', '.deploy-status.json'],
])('GET /projects/:name/%s', (route) => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectStatusRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when the status file is missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: `/projects/myapp/${route}` })

    expect(res.statusCode).toBe(404)
  })

  it('returns 500 without calling the classifier when the file is unparseable', async () => {
    vi.mocked(readFile).mockResolvedValue('not json')

    const res = await app.inject({ method: 'GET', url: `/projects/myapp/${route}` })

    expect(res.statusCode).toBe(500)
    expect(classifyRunState).not.toHaveBeenCalled()
  })

  it('enriches the raw record with runState, keeping the original fields intact', async () => {
    const record = { status: 'deploying', sha: 'abc123', branch: 'main', startedAt: '2026-08-20T00:00:00Z' }
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(record))
    vi.mocked(classifyRunState).mockReturnValue({
      state: 'running',
      reason: 'stub',
      heartbeatAgeSec: 5,
      pidAlive: true,
      sameHost: true,
    })

    const res = await app.inject({ method: 'GET', url: `/projects/myapp/${route}` })

    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.status).toBe('deploying')
    expect(data.sha).toBe('abc123')
    expect(data.branch).toBe('main')
    expect(data.startedAt).toBe('2026-08-20T00:00:00Z')
    expect(data.runState).toEqual({
      state: 'running',
      reason: 'stub',
      heartbeatAgeSec: 5,
      pidAlive: true,
      sameHost: true,
    })
    expect(classifyRunState).toHaveBeenCalledWith(record)
  })
})

describe('status poll logging is quiet about by-design conditions', () => {
  let app: FastifyInstance
  let warn: ReturnType<typeof vi.spyOn>
  let info: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.mocked(discoverProjects).mockResolvedValue([mockProject] as never)
    vi.mocked(sshExec).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as never)
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
