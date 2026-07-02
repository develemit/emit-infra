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

vi.mock('../lib/jsonl.js', () => ({
  readJsonl: vi.fn(),
}))

vi.mock('../lib/hetzner.js', () => ({
  getServerTypeMonthlyPrice: vi.fn().mockResolvedValue(null),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { readJsonl } from '../lib/jsonl.js'
import { scaleAdviceRoutes } from './scale-advice.js'

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

function makePoints(diskValues: number[], memValues?: number[]) {
  return diskValues.map((disk, i) => ({
    t: 1700000000 + i * 60,
    disk,
    memory: memValues ? (memValues[i] ?? 50) : 50,
  }))
}

describe('GET /projects/:name/scale-advice', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(scaleAdviceRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/scale-advice' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns null advice when no metric points exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/scale-advice' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advice: null })
  })

  it('returns null advice when only 5 consecutive disk points exceed 80%', async () => {
    // 7 low points followed by 5 high — streak is 5, threshold is 6
    const points = makePoints([60, 60, 60, 60, 60, 60, 60, 85, 85, 85, 85, 85])
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue(points)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/scale-advice' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advice: null })
  })

  it('returns scale advice when exactly 6 consecutive disk points exceed 80%', async () => {
    // 6 low points followed by 6 high — streak is 6, threshold is 6 → triggers
    const points = makePoints([60, 60, 60, 60, 60, 60, 85, 85, 85, 85, 85, 85])
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue(points)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/scale-advice' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { advice: { resource: string; sustainedPct: number; currentTier: string; nextTier: string } }
    expect(data.advice).not.toBeNull()
    expect(data.advice!.resource).toBe('disk')
    expect(data.advice!.sustainedPct).toBe(85)
    expect(data.advice!.currentTier).toBe('cx22')
    expect(data.advice!.nextTier).toBe('cx32')
  })

  it('returns null advice when 5 consecutive memory points exceed 80%', async () => {
    const diskValues = Array(12).fill(50) as number[]
    // Last 5 memory values are high, first 7 are low
    const memValues = [50, 50, 50, 50, 50, 50, 50, 88, 88, 88, 88, 88]
    const points = makePoints(diskValues, memValues)
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue(points)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/scale-advice' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advice: null })
  })

  it('returns memory advice when 6 consecutive memory points exceed 80%', async () => {
    const diskValues = Array(12).fill(50) as number[]
    const memValues = [50, 50, 50, 50, 50, 50, 88, 88, 88, 88, 88, 88]
    const points = makePoints(diskValues, memValues)
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue(points)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/scale-advice' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { advice: { resource: string } }
    expect(data.advice!.resource).toBe('memory')
  })
})
