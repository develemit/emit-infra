import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {} }),
}))

vi.mock('../lib/project-helpers.js', () => ({
  findProject: vi.fn(),
  sshKeyPath: vi.fn().mockReturnValue('/fake/.ssh/emit-deploy'),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { findProject } from '../lib/project-helpers.js'
import { sshExec } from '@emit-infra/core'
import { nginxConfigRoutes } from './nginx-config.js'

const mockProjectUnconfigured = {
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
  ...mockProjectUnconfigured,
  config: {
    ...mockProjectUnconfigured.config,
    nginx: { wildcardCert: false, customConfigSrc: 'infra/nginx/myapp.conf' },
  },
}

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  void app.register(nginxConfigRoutes)
  return app
}

describe('GET /projects/:name/nginx-drift', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = makeApp()
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(findProject).mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/projects/missing/nginx-drift' })

    expect(res.statusCode).toBe(404)
  })

  it('returns unconfigured when project has no nginx.customConfigSrc', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProjectUnconfigured)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'unconfigured' })
  })

  it('returns missing-local when the local file does not exist', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProject)
    vi.mocked(existsSync).mockReturnValue(false)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'missing-local', localPath: '/projects/myapp/infra/nginx/myapp.conf' })
  })

  it('returns ok when local and server configs match', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProject)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('listen 80;\nserver_name myapp.com;\n')
    vi.mocked(sshExec).mockResolvedValue('listen 80;\nserver_name myapp.com;')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; diff: string[] }
    expect(data.status).toBe('ok')
    expect(data.diff).toEqual([])
  })

  it('returns drift when local and server configs differ', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProject)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('listen 80;\nserver_name new.myapp.com;\n')
    vi.mocked(sshExec).mockResolvedValue('listen 80;\nserver_name old.myapp.com;')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as { status: string; diff: string[] }
    expect(data.status).toBe('drift')
    expect(data.diff.length).toBeGreaterThan(0)
  })

  it('returns missing-server when the server file is empty', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProject)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('listen 80;\n')
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'missing-server' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(findProject).mockResolvedValue(mockProject)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('listen 80;\n')
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/nginx-drift' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })
})
