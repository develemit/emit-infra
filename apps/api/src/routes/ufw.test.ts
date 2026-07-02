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
import { ufwRoutes } from './ufw.js'

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

// Simulates `sudo ufw status numbered` output
const MOCK_UFW_OUTPUT = [
  'Status: active',
  '',
  '     To                         Action      From',
  '     --                         ------      ----',
  '[ 1] 22/tcp                     ALLOW IN    Anywhere',
  '[ 2] 80/tcp                     ALLOW IN    Anywhere',
  '[ 3] 443/tcp                    ALLOW IN    Anywhere',
].join('\n')

describe('GET /projects/:name/ufw-rules', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(ufwRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/ufw-rules' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ufw-rules' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns inactive status with empty rules when ufw is not active', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('Status: inactive')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ufw-rules' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; rules: unknown[] }
    expect(data.status).toBe('inactive')
    expect(data.rules).toEqual([])
  })

  it('parses ufw status numbered output into rules', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(MOCK_UFW_OUTPUT)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/ufw-rules' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      status: string
      rules: Array<{ num: number; to: string; action: string; from: string }>
    }
    expect(data.status).toBe('active')
    expect(data.rules).toHaveLength(3)
    expect(data.rules[0]).toMatchObject({ num: 1, to: '22/tcp', action: 'ALLOW' })
    expect(data.rules[1]).toMatchObject({ num: 2, to: '80/tcp', action: 'ALLOW' })
    expect(data.rules[2]).toMatchObject({ num: 3, to: '443/tcp', action: 'ALLOW' })
  })
})

describe('POST /projects/:name/ufw-rules', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(ufwRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({
      method: 'POST',
      url: '/projects/missing/ufw-rules',
      payload: { rule: 'allow 8080/tcp' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 400 for invalid UFW rule', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/ufw-rules',
      payload: { rule: 'rm -rf /' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'invalid body' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/ufw-rules',
      payload: { rule: 'allow 8080/tcp' },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 201 on successful rule addition', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('Rule added')

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/ufw-rules',
      payload: { rule: 'allow 8080/tcp' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ ok: true, output: 'Rule added' })
  })
})

describe('DELETE /projects/:name/ufw-rules/:num', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(ufwRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'DELETE', url: '/projects/missing/ufw-rules/1' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'DELETE', url: '/projects/myapp/ufw-rules/2' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 200 on successful rule deletion', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('Rule deleted')

    const res = await app.inject({ method: 'DELETE', url: '/projects/myapp/ufw-rules/2' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, output: 'Rule deleted' })
  })
})
