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
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { nginxEndpointsRoutes } from './nginx-endpoints.js'

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

describe('GET /projects/:name/nginx-endpoints', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(nginxEndpointsRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/nginx-endpoints' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-endpoints' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns empty endpoints when ---END1--- delimiter is missing', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('no nginx logs here')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-endpoints' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { available: boolean; endpoints: unknown[] }
    expect(data.available).toBe(false)
    expect(data.endpoints).toEqual([])
  })

  it('parses two-pass awk output with ---END1--- delimiter into endpoints', async () => {
    // Mock output: total counts block, then delimiter, then error counts block
    const mockOutput = [
      '   5678 /api/health',
      '   1234 /api/users',
      '---END1---',
      '     45 /api/users',
    ].join('\n')
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(mockOutput)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-endpoints' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      available: boolean
      endpoints: Array<{ path: string; requests: number; errors: number; errorRate: number }>
    }
    expect(data.available).toBe(true)
    expect(data.endpoints).toHaveLength(2)
    // Sorted by requests descending
    expect(data.endpoints[0]).toMatchObject({ path: '/api/health', requests: 5678, errors: 0 })
    expect(data.endpoints[1]).toMatchObject({ path: '/api/users', requests: 1234, errors: 45 })
    expect(data.endpoints[1]!.errorRate).toBeCloseTo(45 / 1234)
  })
})
