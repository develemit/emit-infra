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
    vi.mocked(sshExec)
      .mockResolvedValueOnce('__EMIT_INFRA_NO_ENV__')
      .mockResolvedValueOnce('')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, added: ['FOO', 'BAZ'], updated: [], preserved: 0 })
    const writeCmd = vi.mocked(sshExec).mock.calls[1]?.[1] ?? ''
    expect(writeCmd).toMatch(/^echo -n '[A-Za-z0-9+/=]+' \| base64 -d > \/opt\/myapp\/\.env$/)
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

  it('resolves the env source using ci.envFile precedence over .env.prod', async () => {
    const projectWithCiEnvFile = {
      ...mockProject,
      config: {
        ...mockProject.config,
        ci: { preCommit: [], prePush: [], ghcrOrg: 'org', sshKey: '~/.ssh/emit-deploy', envFile: '.env.ci' },
      },
    }
    vi.mocked(discoverProjects).mockResolvedValue([projectWithCiEnvFile])
    // Only .env.ci and .env.prod exist; ci.envFile must win.
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('.env.ci') || String(p).endsWith('.env.prod'))
    vi.mocked(readFile).mockResolvedValue('FOO=fromci\n')
    vi.mocked(sshExec)
      .mockResolvedValueOnce('__EMIT_INFRA_NO_ENV__')
      .mockResolvedValueOnce('')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(200)
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining('.env.ci'), 'utf-8')
  })

  it('preserves server-only keys and reports local values winning on shared keys', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('FOO=newval\nNEWKEY=added\n')
    vi.mocked(sshExec)
      .mockResolvedValueOnce('FOO=oldval\nSERVER_ONLY=keepme\n')
      .mockResolvedValueOnce('')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, added: ['NEWKEY'], updated: ['FOO'], preserved: 1 })
    const writeCmd = vi.mocked(sshExec).mock.calls[1]?.[1] ?? ''
    const b64 = writeCmd.match(/echo -n '([A-Za-z0-9+/=]+)'/)?.[1] ?? ''
    const written = Buffer.from(b64, 'base64').toString('utf-8')
    expect(written).toContain('FOO=newval')
    expect(written).toContain('SERVER_ONLY=keepme')
    expect(written).not.toContain('FOO=oldval')
  })

  it('backs up the existing server .env before writing', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('FOO=bar\n')
    vi.mocked(sshExec)
      .mockResolvedValueOnce('FOO=old\n')
      .mockResolvedValueOnce('')

    await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    const writeCmd = vi.mocked(sshExec).mock.calls[1]?.[1] ?? ''
    expect(writeCmd).toMatch(/^cp \/opt\/myapp\/\.env \/opt\/myapp\/\.env\.bak-\d{14} && echo -n /)
  })

  it('skips the backup on a first-time apply with no existing server file', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFile).mockResolvedValue('FOO=bar\n')
    vi.mocked(sshExec)
      .mockResolvedValueOnce('__EMIT_INFRA_NO_ENV__')
      .mockResolvedValueOnce('')

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/secrets-apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, added: ['FOO'], updated: [], preserved: 0 })
    const writeCmd = vi.mocked(sshExec).mock.calls[1]?.[1] ?? ''
    expect(writeCmd).not.toMatch(/^cp /)
    expect(writeCmd).toMatch(/^echo -n /)
  })
})
