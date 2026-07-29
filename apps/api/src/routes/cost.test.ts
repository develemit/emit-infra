import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/discover-projects.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('../lib/hetzner.js', () => ({
  getServerTypeMonthlyPrice: vi.fn(),
  getLiveServerTypeByIp: vi.fn(),
}))

vi.mock('@emit-infra/core', () => ({
  sshExec: vi.fn(),
}))

import { discoverProjects } from '../lib/discover-projects.js'
import { getServerTypeMonthlyPrice, getLiveServerTypeByIp } from '../lib/hetzner.js'
import { sshExec } from '@emit-infra/core'
import { costRoutes } from './cost.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: '1.2.3.4',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
    postgres: {
      version: '16',
      backupBucket: 'my-bucket',
      backupRetainDays: 7,
    },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

const mockProjectNoPostgres = {
  config: {
    name: 'webapp',
    domain: '1.2.3.5',
    region: 'nbg1' as const,
    serverType: 'cx11',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/webapp' },
  },
  configPath: '/projects/webapp/.emit-infra.json',
  projectDir: '/projects/webapp',
}

describe('GET /projects/:name/cost', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    // Default to "no live server matched" so projects without a serverIp behave
    // as they did before drift detection existed.
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue(null)
    app = Fastify({ logger: false })
  })

  afterEach(async () => {
    await app.close()
    vi.resetModules()
  })

  it('returns 404 when project is not found', async () => {
    await app.register(costRoutes)
    await app.ready()

    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/cost' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 400 when project name is invalid', async () => {
    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/bad@name/cost' })

    expect(res.statusCode).toBe(400)
  })

  it('returns cost estimate on happy path with server cost', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProjectNoPostgres])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.2)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/webapp/cost' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      server: { eurPerMonth: number | null; type: string; region: string }
      storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
    }
    expect(data.server.eurPerMonth).toBe(5.2)
    expect(data.server.type).toBe('cx11')
    expect(data.server.region).toBe('nbg1')
    expect(data.storage.bucketName).toBeNull()
  })

  it('handles missing server pricing gracefully', async () => {
    const testProject = {
      config: {
        name: 'noprice',
        domain: '1.2.3.6',
        region: 'nbg1' as const,
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/noprice' },
      },
      configPath: '/projects/noprice/.emit-infra.json',
      projectDir: '/projects/noprice',
    }
    
    vi.mocked(discoverProjects).mockResolvedValue([testProject])
    vi.mocked(getServerTypeMonthlyPrice).mockRejectedValue(new Error('API error'))

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/noprice/cost' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      server: { eurPerMonth: number | null; type: string; region: string }
      storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
    }
    expect(data.server.eurPerMonth).toBeNull()
  })

  it('includes storage cost when postgres bucket exists', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(7.5)
    vi.mocked(sshExec).mockResolvedValue('2024-01-01 10:00:00+0000  5368709120 s3://my-bucket/backup1.tar.gz')

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cost' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      server: { eurPerMonth: number | null; type: string; region: string }
      storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
    }
    expect(data.server.eurPerMonth).toBe(7.5)
    expect(data.storage.bucketName).toBe('my-bucket')
    expect(typeof data.storage.totalBytes).toBe('number')
    expect(typeof data.storage.usdPerMonth).toBe('number')
  })

  it('handles SSH failure for storage gracefully', async () => {
    const testProject = {
      config: {
        name: 'sshfail',
        domain: '1.2.3.7',
        region: 'nbg1' as const,
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/sshfail' },
        postgres: {
          version: '16',
          backupBucket: 'my-bucket',
          backupRetainDays: 7,
        },
      },
      configPath: '/projects/sshfail/.emit-infra.json',
      projectDir: '/projects/sshfail',
    }
    
    vi.mocked(discoverProjects).mockResolvedValue([testProject])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(7.5)
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/sshfail/cost' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      server: { eurPerMonth: number | null; type: string; region: string }
      storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
    }
    expect(data.server.eurPerMonth).toBe(7.5)
    expect(data.storage.totalBytes).toBeNull()
    expect(data.storage.usdPerMonth).toBeNull()
  })

  it('caches result on second call same project', async () => {
    const testProject = {
      config: {
        name: 'cachetest',
        domain: '1.2.3.8',
        region: 'nbg1' as const,
        serverType: 'cx22',
        sshKeyName: 'emit-deploy',
        github: { repo: 'user/cachetest' },
      },
      configPath: '/projects/cachetest/.emit-infra.json',
      projectDir: '/projects/cachetest',
    }
    
    vi.mocked(discoverProjects).mockResolvedValue([testProject])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.2)

    await app.register(costRoutes)
    await app.ready()

    const res1 = await app.inject({ method: 'GET', url: '/projects/cachetest/cost' })
    expect(res1.statusCode).toBe(200)

    const callsBefore = vi.mocked(getServerTypeMonthlyPrice).mock.calls.length

    const res2 = await app.inject({ method: 'GET', url: '/projects/cachetest/cost' })
    expect(res2.statusCode).toBe(200)

    const callsAfter = vi.mocked(getServerTypeMonthlyPrice).mock.calls.length
    expect(callsAfter).toBe(callsBefore)
  })

  // Each test below uses a distinct project name: the cost cache is module-level
  // and survives vi.resetModules(), so reusing a name would serve a cached body.
  const projectWithIp = (name: string, serverType: string) => ({
    config: {
      name,
      domain: `${name}.app`,
      region: 'nbg1' as const,
      serverType,
      serverIp: '178.105.227.175',
      sshKeyName: 'emit-deploy',
      github: { repo: `user/${name}` },
    },
    configPath: `/projects/${name}/.emit-infra.json`,
    projectDir: `/projects/${name}`,
  })

  type CostBody = {
    server: {
      eurPerMonth: number | null
      type: string
      liveType: string | null
      typeDrift: boolean
    }
  }

  it('flags drift and prices the live type when config is stale', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('drifted', 'cx22')])
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue('cpx22')
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(22.99)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/drifted/cost' })
    expect(res.statusCode).toBe(200)

    const data = res.json() as CostBody
    expect(data.server.type).toBe('cx22')
    expect(data.server.liveType).toBe('cpx22')
    expect(data.server.typeDrift).toBe(true)
    // Prices the box that actually exists, not the stale config value.
    expect(vi.mocked(getServerTypeMonthlyPrice).mock.calls[0]?.[0]).toBe('cpx22')
    expect(data.server.eurPerMonth).toBe(22.99)
  })

  it('reports no drift when config matches the live server type', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('nodrift', 'cx33')])
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue('cx33')
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(8.99)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/nodrift/cost' })
    const data = res.json() as CostBody

    expect(data.server.liveType).toBe('cx33')
    expect(data.server.typeDrift).toBe(false)
    expect(data.server.eurPerMonth).toBe(8.99)
  })

  it('does not treat case differences as drift', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('casedrift', 'CX33')])
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue('cx33')
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(8.99)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/casedrift/cost' })
    expect((res.json() as CostBody).server.typeDrift).toBe(false)
  })

  it('skips drift detection when the project has no serverIp', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProjectNoPostgres])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.2)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/webapp/cost' })
    const data = res.json() as CostBody

    expect(data.server.liveType).toBeNull()
    expect(data.server.typeDrift).toBe(false)
    expect(vi.mocked(getLiveServerTypeByIp)).not.toHaveBeenCalled()
  })

  it('still prices the configured type when the live lookup fails', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('lookupfail', 'cx22')])
    vi.mocked(getLiveServerTypeByIp).mockRejectedValue(new Error('Hetzner unreachable'))
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.49)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/lookupfail/cost' })
    expect(res.statusCode).toBe(200)

    const data = res.json() as CostBody
    expect(data.server.liveType).toBeNull()
    expect(data.server.typeDrift).toBe(false)
    expect(vi.mocked(getServerTypeMonthlyPrice).mock.calls[0]?.[0]).toBe('cx22')
    expect(data.server.eurPerMonth).toBe(5.49)
  })
})
