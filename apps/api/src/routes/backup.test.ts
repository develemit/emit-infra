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

vi.mock('../lib/project-helpers.js', () => ({
  sshKeyPath: vi.fn().mockReturnValue('/home/user/.ssh/emit-deploy'),
  findProject: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
  ProjectConfigSchema: { safeParse: vi.fn() },
  runTerraform: vi.fn(),
  runAnsible: vi.fn(),
}))

import { sshExec } from '@emit-infra/core'
import { findProject } from '../lib/project-helpers.js'
import { projectRoutes } from './projects.js'

const mockProjectWithoutBucket = {
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

const mockProjectWithBucket = {
  config: {
    name: 'myapp',
    domain: '1.2.3.4',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    postgres: { version: '16', backupBucket: 'my-backup-bucket', backupRetainDays: 7 },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('GET /projects/:name/backups', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(findProject).mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/projects/missing/backups' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 404 when project found but postgres.backupBucket not configured', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithoutBucket)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backups' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup bucket configured' })
  })

  it('returns 200 with parsed backups array when SSH returns data', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)
    vi.mocked(sshExec).mockResolvedValue(
      '2024-01-15 10:00:00    1048576 myapp_2024-01-15.dump\n2024-01-14 10:00:00    1024000 myapp_2024-01-14.dump\n'
    )

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/backups' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { backups: Array<{ key: string; sizeBytes: number; lastModified: string }> }
    expect(data.backups).toHaveLength(2)
    expect(data.backups[0]?.key).toBe('myapp_2024-01-15.dump')
    expect(data.backups[0]?.sizeBytes).toBe(1048576)
    expect(data.backups[1]?.key).toBe('myapp_2024-01-14.dump')
  })
})

describe('DELETE /projects/:name/backups/:key', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 400 on invalid key with path traversal attempt', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/backups/%2E%2E%2Fetc%2Fpasswd',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid key' })
  })

  it('returns 400 on invalid key with wrong extension', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/backups/backup.sql',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid key' })
  })

  it('returns 404 on no bucket', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithoutBucket)

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/backups/myapp_2024-01-15.dump',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup bucket configured' })
  })

  it('returns 200 on valid key and successful SSH', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/myapp/backups/myapp_2024-01-15.dump',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

describe('POST /projects/:name/backups/trigger', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(findProject).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/projects/missing/backups/trigger',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 404 on no bucket', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithoutBucket)

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/backups/trigger',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup bucket configured' })
  })

  it('returns 200 with ok: true on success', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)
    vi.mocked(sshExec).mockResolvedValue('backup complete\n')

    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/backups/trigger',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { ok: boolean; output: string }
    expect(data.ok).toBe(true)
    expect(data.output).toBe('backup complete\n')
  })
})

describe('GET /projects/:name/backups/:key/download', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 when project not found', async () => {
    vi.mocked(findProject).mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/projects/missing/backups/backup.dump/download',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 404 on no bucket', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithoutBucket)

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/backups/myapp_2024-01-15.dump/download',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no backup bucket configured' })
  })

  it('returns 400 on invalid key', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/backups/%2E%2E%2Fetc%2Fpasswd/download',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid key' })
  })

  it('returns 200 with presigned URL on success', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectWithBucket)
    vi.mocked(sshExec).mockResolvedValue(
      'https://example.com/presigned-url?token=abc123\n'
    )

    const res = await app.inject({
      method: 'GET',
      url: '/projects/myapp/backups/myapp_2024-01-15.dump/download',
    })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { url: string }
    expect(data.url).toBe('https://example.com/presigned-url?token=abc123')
  })
})
