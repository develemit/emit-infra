import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('@emit-infra/core', () => ({
  sshMuxArgs: vi.fn().mockReturnValue([]),
}))

vi.mock('../lib/stream-process.js', () => ({
  streamProcess: vi.fn().mockImplementation(async function* () {
    yield { type: 'done' as const, exitCode: 0 }
  }),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { containerLogsRoutes } from './container-logs.js'

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

describe('GET /projects/:name/containers/:container/logs', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(containerLogsRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 400 for container name with invalid characters', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/containers/_badcontainer/logs',
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/containers/mycontainer/logs',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('sets text/event-stream content-type for valid request', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/containers/mycontainer/logs',
    })

    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['cache-control']).toBe('no-cache')
  })
})
