import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { discoverProjects } from '../lib/discover-projects.js'
import { sshExec } from '@emit-infra/core'
import { secretsSyncRoutes } from './secrets-sync.js'

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

describe('POST /projects/:name/secrets-apply', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
    app = Fastify({ logger: false })
    await app.register(secretsSyncRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 with { error } when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'POST', url: '/projects/missing/secrets-apply' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 404 with { error } when no env file exists', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'No env file found in ~/projects/myapp/' })
  })

  it('returns 400 with { error } when the env file has no secrets', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('# comments only\n')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'No secrets found in env file' })
  })

  it('sends a pure-base64 payload over SSH on the happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('FOO=bar\nBAZ=qux\n')
    vi.mocked(sshExec).mockResolvedValue('')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const cmd = vi.mocked(sshExec).mock.calls[0]?.[1] ?? ''
    expect(cmd).toMatch(/^echo -n '[A-Za-z0-9+/=]+' \| base64 -d > \/opt\/myapp\/\.env$/)
  })

  it('returns 503 with { error } when SSH fails', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('FOO=bar\n')
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'Connection refused' })
  })
})
