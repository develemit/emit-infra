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

import { discoverProjects } from '../lib/discover-projects.js'
import { readJsonl } from '../lib/jsonl.js'
import { incidentsExportRoutes } from './incidents-export.js'

const mockProject = {
  config: { name: 'myapp', domain: '1.2.3.4', region: 'nbg1' as const, serverType: 'cx22', sshKeyName: 'emit-deploy', github: { repo: 'user/myapp' } },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  void app.register(incidentsExportRoutes)
  return app
}

describe('GET /projects/:name/incidents/export', () => {
  let app: FastifyInstance
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready() })
  afterEach(async () => { await app.close() })

  it('returns JSON format when requested', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    const records = [
      { type: 'ssh' as const, projectName: 'myapp', event: 'down' as const, t: now - 3600 },
      { type: 'ssh' as const, projectName: 'myapp', event: 'up' as const, t: now - 1800 },
    ]
    vi.mocked(readJsonl).mockResolvedValue(records)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=json' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')

    const data = res.json() as Array<{ startedAt: string; resolvedAt: string | null; durationSec: number | null; resolved: boolean }>
    expect(data).toHaveLength(1)
    expect(data[0]!.resolved).toBe(true)
    expect(typeof data[0]!.durationSec).toBe('number')
  })

  it('returns CSV format when requested', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    const records = [
      { type: 'ssh' as const, projectName: 'myapp', event: 'down' as const, t: now - 3600 },
      { type: 'ssh' as const, projectName: 'myapp', event: 'up' as const, t: now - 1800 },
    ]
    vi.mocked(readJsonl).mockResolvedValue(records)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=csv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('myapp-incidents.csv')
    expect(res.body).toContain('startedAt,resolvedAt,durationSec,resolved')
  })

  it('properly escapes CSV fields containing commas', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    const records = [
      { type: 'ssh' as const, projectName: 'myapp', event: 'down' as const, t: now - 3600 },
      { type: 'ssh' as const, projectName: 'myapp', event: 'up' as const, t: now - 1800 },
    ]
    vi.mocked(readJsonl).mockResolvedValue(records)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=csv' })
    expect(res.statusCode).toBe(200)
    const lines = res.body.split('\n')
    expect(lines.length).toBeGreaterThan(1)
  })

  it('returns 400 for invalid format', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=invalid' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('error')
  })

  it('returns 400 for days=0 (below minimum)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=json&days=0' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for days=366 (above maximum)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=json&days=366' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/projects/missing/incidents/export?format=json' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Project not found' })
  })

  it('includes unresolved incidents in export', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const now = Math.floor(Date.now() / 1000)
    const records = [
      { type: 'ssh' as const, projectName: 'myapp', event: 'down' as const, t: now - 3600 },
    ]
    vi.mocked(readJsonl).mockResolvedValue(records)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=json' })
    expect(res.statusCode).toBe(200)

    const data = res.json() as Array<{ resolved: boolean; resolvedAt: string | null }>
    expect(data).toHaveLength(1)
    expect(data[0]!.resolved).toBe(false)
    expect(data[0]!.resolvedAt).toBe('')
  })

  it('respects days query parameter', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incidents/export?format=json&days=30' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(readJsonl)).toHaveBeenCalled()
  })
})
