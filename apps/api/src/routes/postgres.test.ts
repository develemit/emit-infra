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
import { postgresRoutes } from './postgres.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'myapp.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    postgres: { version: '16', backupRetainDays: 7 },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

const mockProjectNoPostgres = {
  ...mockProject,
  config: { ...mockProject.config, postgres: undefined },
}

describe('postgres routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(postgresRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /projects/:name/pg-table-sizes', () => {
    it('returns 400 for invalid project name', async () => {
      const res = await app.inject({ method: 'GET', url: '/projects/$bad/pg-table-sizes' })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'invalid params' })
    })

    it('returns 404 for unknown project', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/projects/unknown/pg-table-sizes' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not found' })
    })

    it('returns 404 when postgres not configured', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProjectNoPostgres])
      const res = await app.inject({ method: 'GET', url: '/projects/myapp/pg-table-sizes' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'postgres not configured' })
    })

    it('returns parsed table sizes from mocked SSH output', async () => {
      vi.mocked(discoverProjects).mockResolvedValue([mockProject])
      vi.mocked(sshExec).mockResolvedValue(
        'public.users\t8192\t100\npublic.orders\t16384\t500\n',
      )

      const res = await app.inject({ method: 'GET', url: '/projects/myapp/pg-table-sizes' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        tables: [
          { name: 'public.users', totalBytes: 8192, rowEstimate: 100 },
          { name: 'public.orders', totalBytes: 16384, rowEstimate: 500 },
        ],
      })
    })

    it('returns 503 on SSH failure', async () => {
      const failProject = {
        ...mockProject,
        config: { ...mockProject.config, name: 'failapp' },
      }
      vi.mocked(discoverProjects).mockResolvedValue([failProject])
      vi.mocked(sshExec).mockRejectedValue(new Error('connection refused'))

      const res = await app.inject({ method: 'GET', url: '/projects/failapp/pg-table-sizes' })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: 'unreachable' })
    })
  })
})
