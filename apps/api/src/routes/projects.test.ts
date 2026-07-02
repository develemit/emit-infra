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
  runTerraform: vi.fn(),
  runAnsible: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  readdir: vi.fn().mockResolvedValue([]),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, writeFile } from 'node:fs/promises'
import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { projectRoutes } from './projects.js'

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
    await app.register(projectRoutes)
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

describe('GET /projects', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns registered projects', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({ method: 'GET', url: '/projects' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as Array<{ config: { name: string } }>
    expect(data).toHaveLength(1)
    expect(data[0]?.config.name).toBe('myapp')
  })

  it('returns empty array when no projects exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('GET /projects/:name/backup-status', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns parsed backup status on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(JSON.stringify({ lastRun: '2024-01-01T00:00:00Z', status: 'ok' }))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { lastRun: string; status: string }
    expect(data.status).toBe('ok')
  })

  it('returns 500 when SSH returns corrupt JSON', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('NOT VALID JSON {{{')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid status file' })
  })

  it('returns 404 when no backup status file exists (empty output)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup status' })
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/backup-status' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })
})

describe('GET /projects/:name/containers', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns parsed container list on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('myapp-web|nginx:latest|Up 5 minutes|running|42')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/containers' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as Array<{ name: string; state: string; buildNumber: string }>
    expect(data).toHaveLength(1)
    expect(data[0]?.name).toBe('myapp-web')
    expect(data[0]?.state).toBe('running')
    expect(data[0]?.buildNumber).toBe('42')
  })

  it('returns empty array when no containers running', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/containers' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/containers' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })
})

describe('POST /projects/:name/containers/:container/restart', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns ok with output on success', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('myapp-web')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/containers/myapp-web/restart' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, output: 'myapp-web' })
  })

  it('returns 503 with { error } when the restart fails', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('boom'))

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/containers/myapp-web/restart' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'Error: boom' })
  })
})

describe('PATCH /projects/:name/config', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 500 with clean error when config file is corrupted', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('NOT VALID JSON {{{')

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid project config' })
  })

  it('returns 500 with clean error when config file is unreadable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid project config' })
  })

  it('merges patch into existing config on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ name: 'myapp', domain: '1.2.3.4' }))

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const written = vi.mocked(writeFile).mock.calls[0]?.[1] as string
    expect(JSON.parse(written)).toMatchObject({ name: 'myapp', serverType: 'cx32' })
  })
})
