import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/weekly-digest.js', () => ({
  buildDigest: vi.fn().mockReturnValue({
    incidentCount: 0,
    deployCount: 0,
    diskDeltas: [],
    summaryLine: 'This week: 0 incidents, 0 deploys',
  }),
}))

vi.mock('../lib/jsonl.js', () => ({
  readJsonl: vi.fn().mockResolvedValue([]),
  downsample: vi.fn().mockImplementation((pts: unknown[]) => pts),
}))

vi.mock('../lib/annotations.js', () => ({
  readAnnotations: vi.fn().mockResolvedValue({}),
  writeAnnotation: vi.fn().mockResolvedValue(undefined),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { readJsonl } from '../lib/jsonl.js'
import { buildDigest } from '../lib/weekly-digest.js'
import { fleetRoutes } from './fleet.js'

const mockProject = {
  config: { name: 'myapp', domain: '1.2.3.4', region: 'nbg1' as const, serverType: 'cx22', sshKeyName: 'emit-deploy', github: { repo: 'user/myapp' } },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  void app.register(fleetRoutes)
  return app
}

describe('GET /fleet/incidents', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns 400 for invalid days param', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/fleet/incidents?days=0' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for days > 90', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/fleet/incidents?days=91' })
    expect(res.statusCode).toBe(400)
  })

  it('returns empty array when no incidents or deploys', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/fleet/incidents?days=7' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns project entry when incidents exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    vi.mocked(readJsonl)
      .mockResolvedValueOnce([
        { type: 'ssh', event: 'down', t: now - 3600 },
        { type: 'ssh', event: 'up', t: now - 1800 },
      ])
      .mockResolvedValueOnce([])

    const res = await app.inject({ method: 'GET', url: '/fleet/incidents?days=7' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as Array<{ project: string; incidents: unknown[]; deploys: unknown[] }>
    expect(data).toHaveLength(1)
    expect(data[0]!.project).toBe('myapp')
    expect(data[0]!.incidents).toHaveLength(1)
  })

  it('merges annotations into incidents', async () => {
    const { readAnnotations } = await import('../lib/annotations.js')
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    vi.mocked(readJsonl)
      .mockResolvedValueOnce([{ type: 'ssh', event: 'down', t: now - 3600 }])
      .mockResolvedValueOnce([])
    vi.mocked(readAnnotations).mockResolvedValue({ [String(now - 3600)]: { note: 'test', falsePositive: true } })

    const res = await app.inject({ method: 'GET', url: '/fleet/incidents?days=7' })
    expect(res.statusCode).toBe(200)
    const data = res.json() as Array<{ incidents: Array<{ note: string; falsePositive: boolean }> }>
    expect(data[0]!.incidents[0]!.note).toBe('test')
    expect(data[0]!.incidents[0]!.falsePositive).toBe(true)
  })
})

describe('GET /fleet/digest', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns 400 for invalid days param', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/fleet/digest?days=0' })
    expect(res.statusCode).toBe(400)
  })

  it('returns digest from buildDigest', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readJsonl).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/fleet/digest?days=7' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { summaryLine: string }
    expect(body.summaryLine).toBe('This week: 0 incidents, 0 deploys')
    expect(vi.mocked(buildDigest)).toHaveBeenCalled()
  })

  it('passes incidents and deploys to buildDigest', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    // readJsonl called 3x per project: incidents, deploys, metrics
    vi.mocked(readJsonl)
      .mockResolvedValueOnce([
        { type: 'ssh', event: 'down', t: now - 3600 },
        { type: 'ssh', event: 'up', t: now - 1800 },
      ])
      .mockResolvedValueOnce([{ completedAt: new Date().toISOString(), status: 'success' }])
      .mockResolvedValueOnce([]) // metrics

    await app.inject({ method: 'GET', url: '/fleet/digest?days=7' })

    const call = vi.mocked(buildDigest).mock.calls[0]![0]!
    expect(call[0]!.project).toBe('myapp')
    expect(call[0]!.incidents).toHaveLength(1)
    expect(call[0]!.deploys).toHaveLength(1)
  })
})
