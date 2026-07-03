import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

const mockAnnotations: Record<string, unknown> = {}

vi.mock('../lib/annotations.js', () => ({
  readAnnotations: vi.fn().mockImplementation(() => Promise.resolve({ ...mockAnnotations })),
  writeAnnotation: vi.fn().mockImplementation((_path: string, key: string, patch: unknown) => {
    mockAnnotations[key] = { ...(mockAnnotations[key] as object | undefined), ...(patch as object) }
    return Promise.resolve()
  }),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { readAnnotations, writeAnnotation } from '../lib/annotations.js'
import { incidentAnnotationRoutes } from './incident-annotations.js'

const mockProject = {
  config: { name: 'myapp', domain: '1.2.3.4', region: 'nbg1' as const, serverType: 'cx22', sshKeyName: 'emit-deploy', github: { repo: 'user/myapp' } },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  void app.register(incidentAnnotationRoutes)
  return app
}

describe('PUT /projects/:name/incidents/:startedAt/annotation', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(mockAnnotations).forEach(k => delete mockAnnotations[k])
    app = makeApp()
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  it('persists a note and false-positive flag', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/1750000000/annotation',
      payload: { note: 'Scheduled maintenance', falsePositive: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(vi.mocked(writeAnnotation)).toHaveBeenCalledWith(
      expect.stringContaining('myapp'),
      '1750000000',
      { note: 'Scheduled maintenance', falsePositive: true },
    )
  })

  it('accepts note-only body', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/1750000000/annotation',
      payload: { note: 'DNS blip' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts falsePositive-only body', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/1750000000/annotation',
      payload: { falsePositive: false },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 400 when body has neither note nor falsePositive', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/1750000000/annotation',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('error')
  })

  it('returns 400 when note exceeds 500 chars', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/1750000000/annotation',
      payload: { note: 'x'.repeat(501) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for invalid startedAt param', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/myapp/incidents/not-a-number/annotation',
      payload: { note: 'test' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/missing/incidents/1750000000/annotation',
      payload: { note: 'test' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Project not found' })
  })
})

describe('GET /projects/:name/incident-annotations', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(mockAnnotations).forEach(k => delete mockAnnotations[k])
    app = makeApp()
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  it('returns the annotation map', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readAnnotations).mockResolvedValue({ '1750000000': { note: 'test', falsePositive: true } })

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/incident-annotations' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ '1750000000': { note: 'test', falsePositive: true } })
  })

  it('returns 404 for unknown project', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/projects/nope/incident-annotations' })
    expect(res.statusCode).toBe(404)
  })
})
