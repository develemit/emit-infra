import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
  discoverUnregistered: vi.fn().mockResolvedValue([]),
}))

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}))

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/notify.js', () => ({
  notify: vi.fn().mockResolvedValue({}),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { notify } from '../lib/notify.js'
import { deployRoutes } from './deploy.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'myapp.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

describe('deploy webhook routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(deployRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('POST /projects/:name/deploy returns 404 for unknown project', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/projects/missing/deploy' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('POST /projects/:name/deploy returns 202 and starts deploy', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    const res = await app.inject({
      method: 'POST',
      url: '/projects/myapp/deploy',
      payload: { sha: 'abc123', branch: 'main', buildNumber: '42' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(body.startedAt).toBeDefined()
  })

  it('POST /projects/:name/deploy returns 409 if deploy already running', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])

    await app.inject({ method: 'POST', url: '/projects/myapp/deploy' })

    const res = await app.inject({ method: 'POST', url: '/projects/myapp/deploy' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('deploy already running')
  })

  it('POST /projects/:name/deploy returns 400 for invalid name', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects/$bad-name/deploy' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid project name')
  })

  it('deploy complete notifies at info severity without an email', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    await app.inject({ method: 'POST', url: '/projects/myapp/deploy', payload: { sha: 'abc1234', branch: 'main', buildNumber: '42' } })
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.severity).toBe('info')
    expect(arg.title).toBe('myapp: deploy complete')
    expect(arg.email).toBeUndefined()
  })

  it('deploy failed notifies at alert severity with the deploy-failed email', async () => {
    const { execa } = await import('execa')
    vi.mocked(execa).mockRejectedValueOnce(new Error('docker build exploded'))
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    await app.inject({ method: 'POST', url: '/projects/myapp/deploy', payload: { sha: 'abc1234def', branch: 'main', buildNumber: '43' } })
    await vi.waitFor(() => expect(vi.mocked(notify).mock.calls.some(([a]) => a.severity === 'alert')).toBe(true))
    const arg = vi.mocked(notify).mock.calls.map(([a]) => a).find(a => a.severity === 'alert')!
    expect(arg.title).toBe('myapp: deploy failed')
    expect(arg.email?.subject).toBe('[emit-infra] 🔴 myapp deploy #43 failed')
    expect(arg.email?.text).toContain('docker build exploded')
    expect(arg.email?.text).toContain('abc1234')
  })
})
