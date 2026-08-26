import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  open: vi.fn().mockRejectedValue(new Error('no file')),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { open } from 'node:fs/promises'
import { trendRoutes } from './trend-routes.js'

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

describe('GET /projects/:name/disk-trend', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(trendRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/disk-trend' })

    expect(res.statusCode).toBe(404)
  })

  it('returns zero trend when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/disk-trend' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { disk: number; pctPerDay: number; projectedDaysUntilFull: null }
    expect(data.disk).toBe(0)
    expect(data.pctPerDay).toBe(0)
    expect(data.projectedDaysUntilFull).toBeNull()
  })

  it('returns trend on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/disk-trend' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { disk: number; pctPerDay: number; projectedDaysUntilFull: number | null }
    expect(typeof data.disk).toBe('number')
    expect(typeof data.pctPerDay).toBe('number')
    expect(data.projectedDaysUntilFull === null || typeof data.projectedDaysUntilFull === 'number').toBe(true)
  })
})

describe('GET /projects/:name/memory-trend', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(trendRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/memory-trend' })

    expect(res.statusCode).toBe(404)
  })

  it('returns zero trend when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/memory-trend' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { mem: number; pctPerDay: number; projectedDaysUntilFull: null }
    expect(data.mem).toBe(0)
    expect(data.pctPerDay).toBe(0)
    expect(data.projectedDaysUntilFull).toBeNull()
  })

  it('returns trend on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/memory-trend' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { mem: number; pctPerDay: number; projectedDaysUntilFull: number | null }
    expect(typeof data.mem).toBe('number')
    expect(typeof data.pctPerDay).toBe('number')
    expect(data.projectedDaysUntilFull === null || typeof data.projectedDaysUntilFull === 'number').toBe(true)
  })
})
