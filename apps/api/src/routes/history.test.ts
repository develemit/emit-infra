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

import { discoverProjects } from '../lib/discover-projects.js'
import { readFile, open } from 'node:fs/promises'
import { historyRoutes } from './history.js'

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

describe('GET /projects/:name/metrics', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/metrics' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns empty points when metrics file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/metrics' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { points: unknown[]; range: unknown }
    expect(data.points).toEqual([])
    expect(data.range).toHaveProperty('from')
    expect(data.range).toHaveProperty('to')
  })

  it('returns downsampled metric points on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/metrics?hours=1',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { points: unknown[]; range: { from: number; to: number } }
    expect(Array.isArray(data.points)).toBe(true)
    expect(typeof data.range.from).toBe('number')
    expect(typeof data.range.to).toBe('number')
  })
})

describe('GET /projects/:name/deploy-history', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/deploy-history' })

    expect(res.statusCode).toBe(404)
  })

  it('returns empty deploys array when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-history' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { deploys: unknown[] }
    expect(data.deploys).toEqual([])
  })

  it('returns deploys on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/deploy-history?limit=10',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { deploys: unknown[] }
    expect(Array.isArray(data.deploys)).toBe(true)
  })
})

describe('GET /projects/:name/ci-history', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/ci-history' })

    expect(res.statusCode).toBe(404)
  })

  it('returns empty runs array when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-history' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { runs: unknown[] }
    expect(data.runs).toEqual([])
  })

  it('returns runs on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/ci-history?limit=10',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { runs: unknown[] }
    expect(Array.isArray(data.runs)).toBe(true)
  })
})

describe('GET /projects/:name/ci-log/:sha', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/ci-log/abc1234' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when sha is invalid', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/tooshort' })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when log file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/abc1234567' })

    expect(res.statusCode).toBe(404)
  })

  it('returns plain text log on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('Build log content here\nLine 2')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/abc1234567' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toBe('Build log content here\nLine 2')
  })
})

describe('GET /projects/:name/deploy-log/:sha', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/deploy-log/abc1234' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when sha is invalid', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-log/tooshort' })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when log file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-log/abc1234567' })

    expect(res.statusCode).toBe(404)
  })

  it('returns plain text log on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('Deploy log content\nSuccess')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-log/abc1234567' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toBe('Deploy log content\nSuccess')
  })
})

describe('GET /projects/:name/disk-trend', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
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
    await app.register(historyRoutes)
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

describe('GET /projects/:name/container-restarts', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(historyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/container-restarts' })

    expect(res.statusCode).toBe(404)
  })

  it('returns empty object when file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/container-restarts',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as Record<string, unknown>
    expect(typeof data).toBe('object')
    expect(Object.keys(data).length).toBe(0)
  })

  it('returns restarts data on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/container-restarts?hours=24',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as Record<string, unknown>
    expect(typeof data).toBe('object')
  })
})
