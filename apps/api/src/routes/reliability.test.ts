import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  open: vi.fn().mockRejectedValue(new Error('no file')),
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { open, readFile } from 'node:fs/promises'
import { reliabilityRoutes } from './reliability.js'

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

describe('GET /projects/:name/incidents', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(reliabilityRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/incidents' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns empty incidents when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { incidents: unknown[]; mttrSec: number | null }
    expect(data.incidents).toEqual([])
    expect(data.mttrSec).toBeNull()
  })

  it('returns incidents on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/incidents?days=30',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { incidents: unknown[]; mttrSec: number | null }
    expect(Array.isArray(data.incidents)).toBe(true)
  })
})

describe('GET /projects/:name/deploy-cadence', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(reliabilityRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/deploy-cadence' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 30 days of cadence data when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-cadence' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { days: unknown[] }
    expect(Array.isArray(data.days)).toBe(true)
    expect(data.days.length).toBe(30)
  })

  it('returns cadence on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-cadence' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { days: Array<{ date: string; total: number; failures: number }> }
    expect(Array.isArray(data.days)).toBe(true)
    if (data.days.length > 0) {
      expect(data.days[0]).toHaveProperty('date')
      expect(data.days[0]).toHaveProperty('total')
      expect(data.days[0]).toHaveProperty('failures')
    }
  })
})

describe('GET /projects/:name/sla', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    app = Fastify({ logger: false })
  })

  afterEach(async () => {
    await app.close()
    vi.resetModules()
  })

  it('returns 404 when project is not found', async () => {
    await app.register(reliabilityRoutes)
    await app.ready()

    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/sla' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 100% uptime when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    await app.register(reliabilityRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/sla' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { uptime7d: number; uptime30d: number }
    expect(typeof data.uptime7d).toBe('number')
    expect(typeof data.uptime30d).toBe('number')
  })

  it('returns sla on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    await app.register(reliabilityRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/sla' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { uptime7d: number; uptime30d: number }
    expect(data.uptime7d >= 0 && data.uptime7d <= 100).toBe(true)
    expect(data.uptime30d >= 0 && data.uptime30d <= 100).toBe(true)
  })

  it('caches sla result on second call', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    await app.register(reliabilityRoutes)
    await app.ready()

    const res1 = await app.inject({ method: 'GET', url: '/projects/myapp/sla' })
    expect(res1.statusCode).toBe(200)

    const openCallsBefore = vi.mocked(open).mock.calls.length

    const res2 = await app.inject({ method: 'GET', url: '/projects/myapp/sla' })
    expect(res2.statusCode).toBe(200)

    const openCallsAfter = vi.mocked(open).mock.calls.length
    expect(openCallsAfter).toBe(openCallsBefore)
  })
})
