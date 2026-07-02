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
import { secretsRoutes } from './secrets.js'

const mockProjectNoKeys = {
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

const mockProject = {
  ...mockProjectNoKeys,
  config: {
    ...mockProjectNoKeys.config,
    requiredEnvKeys: ['DATABASE_URL', 'API_KEY', 'SECRET_TOKEN'],
  },
}

describe('GET /projects/:name/secrets-drift', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(secretsRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/secrets-drift' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns unconfigured when project has no requiredEnvKeys', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProjectNoKeys])

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/secrets-drift' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'unconfigured' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/secrets-drift' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns status ok when all required keys are present on server', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('DATABASE_URL\nAPI_KEY\nSECRET_TOKEN')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/secrets-drift' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; missing: string[]; extra: string[]; present: string[] }
    expect(data.status).toBe('ok')
    expect(data.missing).toEqual([])
    expect(data.present).toContain('DATABASE_URL')
  })

  it('returns status drift when required keys are missing from server', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('DATABASE_URL\nAPI_KEY')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/secrets-drift' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; missing: string[] }
    expect(data.status).toBe('drift')
    expect(data.missing).toContain('SECRET_TOKEN')
  })

  it('reports extra keys present on server not in requiredEnvKeys', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('DATABASE_URL\nAPI_KEY\nSECRET_TOKEN\nUNEXPECTED_KEY')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/secrets-drift' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; extra: string[] }
    expect(data.status).toBe('ok')
    expect(data.extra).toContain('UNEXPECTED_KEY')
  })
})
