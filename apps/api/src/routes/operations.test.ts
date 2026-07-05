import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
  sshMuxArgs: vi.fn().mockReturnValue([]),
  runTerraform: vi.fn().mockResolvedValue(undefined),
  getTerraformOutput: vi.fn().mockResolvedValue('1.2.3.4'),
  runAnsible: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/scaffold-project.js', () => ({
  scaffoldProject: vi.fn().mockResolvedValue(undefined),
  writeInventory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/stream-process.js', () => ({
  streamProcess: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { access } from 'node:fs/promises'
import { operationRoutes } from './operations.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'myapp.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    serverIp: '1.2.3.4',
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('operations routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(operationRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /projects/:name/provision', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'POST', url: '/projects/$bad/provision' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for unknown project without config', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({
        method: 'POST',
        url: '/projects/unknown/provision',
        payload: {},
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })

    it('returns SSE error when terraform dir missing', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))

      const res = await app.inject({
        method: 'POST',
        url: '/projects/myapp/provision',
        payload: {},
      })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('"type":"error"')
      expect(res.payload).toContain('terraform/ directory not found')
    })

    it('streams SSE done event on successful provision', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(access).mockResolvedValue(undefined)

      const res = await app.inject({
        method: 'POST',
        url: '/projects/myapp/provision',
        payload: {},
      })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('"type":"done"')
      expect(res.payload).toContain('"exitCode":0')
    })
  })

  describe('POST /projects/:name/destroy', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'POST', url: '/projects/$bad/destroy' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for unknown project', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({ method: 'POST', url: '/projects/unknown/destroy' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })

    it('returns SSE error when terraform dir missing', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))

      const res = await app.inject({ method: 'POST', url: '/projects/myapp/destroy' })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('"type":"error"')
      expect(res.payload).toContain('terraform/ directory not found')
    })

    it('streams SSE done event on successful destroy', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(access).mockResolvedValue(undefined)

      const res = await app.inject({ method: 'POST', url: '/projects/myapp/destroy' })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('"type":"done"')
      expect(res.payload).toContain('"exitCode":0')
    })
  })

  describe('GET /projects/:name/logs', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'GET', url: '/projects/$bad/logs' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 for invalid service name', async () => {
      const res = await app.inject({ method: 'GET', url: '/projects/myapp/logs?service=$evil' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for unknown project', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/projects/unknown/logs' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })
  })
})
