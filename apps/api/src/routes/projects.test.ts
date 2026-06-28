import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {} }),
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
