import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { rollbackRoutes } from './rollback.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'myapp.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    deploy: { appDir: '/app', composeSrc: 'docker-compose.yml', composeDest: 'docker-compose.yml', extraFiles: [], postDeployExec: [] },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('rollback routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(rollbackRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /projects/:name/rollback/snapshots', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'GET', url: '/projects/$bad/rollback/snapshots' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for unknown project', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/projects/unknown/rollback/snapshots' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })

    it('returns parsed snapshots from mocked sshExec', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(sshExec)
        .mockResolvedValueOnce('registry/myapp:latest\n')
        .mockResolvedValueOnce('registry/myapp:rollback-20260701\nregistry/myapp:rollback-20260630\n')

      const res = await app.inject({ method: 'GET', url: '/projects/myapp/rollback/snapshots' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        snapshots: ['registry/myapp:rollback-20260701', 'registry/myapp:rollback-20260630'],
      })
    })

    it('returns empty snapshots on SSH failure', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(sshExec).mockRejectedValue(new Error('connection refused'))

      const res = await app.inject({ method: 'GET', url: '/projects/myapp/rollback/snapshots' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ snapshots: [] })
    })
  })

  describe('POST /projects/:name/rollback', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'POST', url: '/projects/$bad/rollback' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 for timestamp with shell metacharacters', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      const res = await app.inject({
        method: 'POST',
        url: '/projects/myapp/rollback',
        payload: { timestamp: 'foo;rm -rf' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for unknown project', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({
        method: 'POST',
        url: '/projects/unknown/rollback',
        payload: {},
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })

    it('streams SSE events on successful rollback', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(sshExec)
        .mockResolvedValueOnce('registry/myapp:latest\n')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('Container myapp-web-1 Started\n')

      const res = await app.inject({
        method: 'POST',
        url: '/projects/myapp/rollback',
        payload: { timestamp: 'rollback-20260701' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('"type":"line"')
      expect(res.payload).toContain('"type":"done"')
    })
  })
})
