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
import { projectBackupsRoutes } from './project-backups.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: '1.2.3.4',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    postgres: {
      backupBucket: 'my-bucket',
    },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('GET /projects/:name/backup-status', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectBackupsRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns parsed backup status on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(JSON.stringify({ lastRun: '2024-01-01T00:00:00Z', status: 'ok' }))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { lastRun: string; status: string }
    expect(data.status).toBe('ok')
  })

  it('returns 500 when SSH returns corrupt JSON', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('NOT VALID JSON {{{')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid status file' })
  })

  it('returns 404 when no backup status file exists (empty output)', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backup-status' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup status' })
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/backup-status' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })
})
