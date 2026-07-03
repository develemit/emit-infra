import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}))

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/push.js', () => ({
  sendToAll: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { deployRoutes } from './deploy.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'myapp.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('deploy webhook routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(deployRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('POST /projects/:name/deploy returns 404 for unknown project', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/projects/missing/deploy' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('POST /projects/:name/deploy returns 202 and starts deploy', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/deploy',
      payload: { sha: 'abc123', branch: 'main', buildNumber: '42' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(body.startedAt).toBeDefined()
  })

  it('POST /projects/:name/deploy returns 409 if deploy already running', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    await app.inject({ method: 'POST', url: '/projects/myapp/deploy' })

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/deploy' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('deploy already running')
  })

  it('GET /projects/:name/deploy-status returns idle when no deploy', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/otherapp/deploy-status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'idle' })
  })

  it('GET /projects/:name/deploy-status returns running state after POST', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    await app.inject({ method: 'POST', url: '/projects/myapp/deploy' })

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/deploy-status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('running')
    expect(body.startedAt).toBeDefined()
  })

  it('POST /projects/:name/deploy returns 400 for invalid name', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects/$bad-name/deploy' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid project name')
  })
})
