import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/jsonl.js', () => ({
  readJsonl: vi.fn(),
  downsample: vi.fn().mockImplementation((pts: unknown[]) => pts),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { readJsonl } from '../lib/jsonl.js'
import { readFile } from 'node:fs/promises'
import { historyRoutes } from './history.js'

const mockProject = {
  config: { name: 'myapp', domain: '1.2.3.4', region: 'nbg1' as const, serverType: 'cx22', sshKeyName: 'emit-deploy', github: { repo: 'user/myapp' } },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  void app.register(historyRoutes)
  return app
}

describe('GET /projects/:name/metrics', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns points and range on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const pts = [{ t: 1000, cpu: 10, mem: 40, memUsedMb: 400, memTotalMb: 1000, disk: 50, diskUsedGb: '10G', diskTotalGb: '20G', netRxBytes: 0, netTxBytes: 0, containers: [] }]
    vi.mocked(readJsonl).mockResolvedValue(pts)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/metrics' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as { points: unknown[]; range: { from: number; to: number } }
    expect(data.points).toHaveLength(1)
    expect(data.range.from).toBe(1000)
  })

  it('returns empty points when no metrics exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/metrics' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as { points: unknown[] }
    expect(data.points).toHaveLength(0)
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/projects/missing/metrics' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 400 when hours=0 (below minimum)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/metrics?hours=0' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when hours=721 (above maximum)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/metrics?hours=721' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /projects/:name/deploy-history', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns deploys in reverse order', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const deploys = [
      { status: 'success', sha: 'aaa', branch: 'main', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z', durationSec: 60, servicesBuilt: [] },
      { status: 'success', sha: 'bbb', branch: 'main', startedAt: '2024-01-02T00:00:00Z', completedAt: '2024-01-02T00:01:00Z', durationSec: 60, servicesBuilt: [] },
    ]
    vi.mocked(readJsonl).mockResolvedValue(deploys)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-history?limit=10' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as { deploys: Array<{ sha: string }> }
    expect(data.deploys).toHaveLength(2)
    expect(data.deploys[0]?.sha).toBe('bbb')
  })

  it('respects limit query param', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const deploys = Array.from({ length: 10 }, (_, i) => ({
      status: 'success', sha: `sha${i}`, branch: 'main',
      startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:01:00Z',
      durationSec: 60, servicesBuilt: [],
    }))
    vi.mocked(readJsonl).mockResolvedValue(deploys)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-history?limit=3' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as { deploys: unknown[] }
    expect(data.deploys).toHaveLength(3)
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/projects/missing/deploy-history' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when limit=201 (above maximum)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-history?limit=201' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /projects/:name/ci-history', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns runs when project exists', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const runs = [{ status: 'success', sha: 'abc1234', branch: 'main', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:05:00Z', durationSec: 300 }]
    vi.mocked(readJsonl).mockResolvedValue(runs)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-history' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as { runs: unknown[] }
    expect(data.runs).toHaveLength(1)
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/projects/missing/ci-history' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /projects/:name/ci-log/:sha', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns log content as text on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('line1\nline2\n' as never)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/abc1234abc' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('line1\nline2\n')
  })

  it('returns 404 when log file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/abc1234abc' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when sha contains invalid characters', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ci-log/not-valid-sha' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /projects/:name/deploy-log/:sha', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns log content as text on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('deploy started\ndeploy done\n' as never)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-log/deadbeef' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('deploy started')
  })

  it('returns 404 when log file does not exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-log/deadbeef' })
    expect(res.statusCode).toBe(404)
  })
})
