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
import { cronRoutes } from './cron.js'

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

// Simulates multi-section cron output with === section headers and --- file headers
const MOCK_CRON_OUTPUT = [
  '=== /etc/cron.d/ ===',
  '--- /etc/cron.d/emit-backup ---',
  '# backup job',
  '0 2 * * * root /usr/local/bin/emit-db-backup-myapp',
  '=== /var/spool/cron/crontabs/root ===',
  '=== crontab -l ===',
  '30 4 * * * /usr/bin/certbot renew --quiet',
].join('\n')

describe('GET /projects/:name/cron-jobs', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(cronRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/cron-jobs' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cron-jobs' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns empty jobs list when cron output is empty', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(
      '=== /etc/cron.d/ ===\n=== /var/spool/cron/crontabs/root ===\n=== crontab -l ===',
    )

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cron-jobs' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobs: [] })
  })

  it('parses cron jobs from multi-section output', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(MOCK_CRON_OUTPUT)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cron-jobs' })

    expect(res.statusCode).toBe(200)
    const { jobs } = res.json() as { jobs: Array<{ schedule: string; command: string; source: string; user?: string }> }
    expect(jobs.length).toBeGreaterThanOrEqual(1)

    const backupJob = jobs.find(j => j.command.includes('emit-db-backup'))
    expect(backupJob).toBeDefined()
    expect(backupJob?.schedule).toBe('0 2 * * *')
    expect(backupJob?.user).toBe('root')
    expect(backupJob?.source).toBe('/etc/cron.d/emit-backup')

    const certbotJob = jobs.find(j => j.command.includes('certbot'))
    expect(certbotJob).toBeDefined()
    expect(certbotJob?.schedule).toBe('30 4 * * *')
    expect(certbotJob?.source).toBe('crontab -l')
  })
})

describe('POST /projects/:name/cron-jobs', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(cronRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({
      method: 'POST',
      url: '/projects/missing/cron-jobs',
      payload: { schedule: '0 2 * * *', command: '/usr/bin/backup' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 400 for invalid cron schedule', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/cron-jobs',
      payload: { schedule: 'not-a-schedule', command: '/usr/bin/backup' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'invalid body' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/cron-jobs',
      payload: { schedule: '0 2 * * *', command: '/usr/bin/backup' },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 201 on successful cron job creation', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/cron-jobs',
      payload: { schedule: '0 2 * * *', command: '/usr/local/bin/my-backup' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ ok: true })
  })
})

describe('DELETE /projects/:name/cron-jobs', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(cronRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/missing/cron-jobs',
      payload: { schedule: '0 2 * * *', command: '/usr/bin/backup' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/cron-jobs',
      payload: { schedule: '0 2 * * *', command: '/usr/bin/backup' },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 200 on successful cron job deletion', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/cron-jobs',
      payload: { schedule: '30 4 * * *', command: '/usr/bin/certbot renew --quiet' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})
