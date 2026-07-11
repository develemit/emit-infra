import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {}, invalidate: () => {} }),
}))

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { projectDockerRoutes } from './project-docker.js'

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

describe('GET /projects/:name/containers', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectDockerRoutes)
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
    await app.register(projectDockerRoutes)
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
