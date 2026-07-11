import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  readdir: vi.fn().mockResolvedValue([]),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, writeFile } from 'node:fs/promises'
import { discoverProjects } from '../lib/discover-projects.js'
import { projectRoutes } from './projects.js'

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

describe('GET /projects', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns registered projects', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({ method: 'GET', url: '/projects' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as Array<{ config: { name: string } }>
    expect(data).toHaveLength(1)
    expect(data[0]?.config.name).toBe('myapp')
  })

  it('returns empty array when no projects exist', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('PATCH /projects/:name/config', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(projectRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 500 with clean error when config file is corrupted', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue('NOT VALID JSON {{{')

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid project config' })
  })

  it('returns 500 with clean error when config file is unreadable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'invalid project config' })
  })

  it('merges patch into existing config on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ name: 'myapp', domain: '1.2.3.4' }))

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/myapp/config',
      payload: { serverType: 'cx32' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const written = vi.mocked(writeFile).mock.calls[0]?.[1] as string
    expect(JSON.parse(written)).toMatchObject({ name: 'myapp', serverType: 'cx32' })
  })
})
