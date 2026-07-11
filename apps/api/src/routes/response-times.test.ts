import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { responseTimeRoutes } from './response-times.js'

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

const mockProject2 = {
  config: {
    name: 'othapp',
    domain: '1.2.3.5',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/othapp' },
  },
  configPath: '/projects/othapp/.emit-infra.json',
  projectDir: '/projects/othapp',
}

const mockProject3 = {
  config: {
    name: 'thirdapp',
    domain: '1.2.3.6',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/thirdapp' },
  },
  configPath: '/projects/thirdapp/.emit-infra.json',
  projectDir: '/projects/thirdapp',
}

describe('GET /projects/:name/response-times', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    if (app) await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/missing/response-times' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 400 when project name is invalid', async () => {
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/bad@name/response-times' })

    expect(res.statusCode).toBe(400)
  })

  it('returns 503 when SSH connection fails', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/response-times' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns response times on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject2])
    vi.mocked(sshExec).mockResolvedValue('0.050 0.150 0.300 5000')
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/othapp/response-times' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      available: boolean
      p50ms?: number
      p95ms?: number
      p99ms?: number
      sampleCount?: number
    }
    expect(data.available).toBe(true)
    expect(data.p50ms).toBe(50)
    expect(data.p95ms).toBe(150)
    expect(data.p99ms).toBe(300)
    expect(data.sampleCount).toBe(5000)
  })

  it('returns unavailable when no nginx logs found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject3])
    vi.mocked(sshExec).mockResolvedValue('')
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/thirdapp/response-times' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { available: boolean }
    expect(data.available).toBe(false)
  })

  it('caches result on second call same project', async () => {
    const testProject = {
      config: {
        name: 'cachetest',
        domain: '1.2.3.7',
        region: 'nbg1' as const,
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/cachetest' },
      },
      configPath: '/projects/cachetest/.emit-infra.json',
      projectDir: '/projects/cachetest',
    }

    vi.mocked(discoverProjects).mockResolvedValue([testProject])
    vi.mocked(sshExec).mockResolvedValue('0.050 0.150 0.300 5000')
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res1 = await app.inject({ method: 'GET', url: '/projects/cachetest/response-times' })
    expect(res1.statusCode).toBe(200)

    const callsBefore = vi.mocked(sshExec).mock.calls.length

    const res2 = await app.inject({ method: 'GET', url: '/projects/cachetest/response-times' })
    expect(res2.statusCode).toBe(200)

    const callsAfter = vi.mocked(sshExec).mock.calls.length
    expect(callsAfter).toBe(callsBefore)
  })

  it('caches failure on second call after SSH error', async () => {
    const testProject = {
      config: {
        name: 'failcachetest',
        domain: '1.2.3.8',
        region: 'nbg1' as const,
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/failcachetest' },
      },
      configPath: '/projects/failcachetest/.emit-infra.json',
      projectDir: '/projects/failcachetest',
    }

    vi.mocked(discoverProjects).mockResolvedValue([testProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))
    app = Fastify({ logger: false })
    await app.register(responseTimeRoutes)
    await app.ready()

    const res1 = await app.inject({ method: 'GET', url: '/projects/failcachetest/response-times' })
    expect(res1.statusCode).toBe(503)

    vi.mocked(sshExec).mockClear()

    const res2 = await app.inject({ method: 'GET', url: '/projects/failcachetest/response-times' })
    expect(res2.statusCode).toBe(503)

    expect(vi.mocked(sshExec).mock.calls.length).toBe(0)
  })
})
