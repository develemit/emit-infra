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
import { costRoutes } from './cost.js'

const mockProjectNoIp = {
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
    driftStatus: 'matching' | 'drifted' | 'unknown'
  }
}

describe('GET /projects/:name/cost — drift detection', () => {
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
    expect(data.server.driftStatus).toBe('drifted')
    // Prices the box that actually exists, not the stale config value.
    expect(vi.mocked(getServerTypeMonthlyPrice).mock.calls[0]?.[0]).toBe('cpx22')
    expect(data.server.eurPerMonth).toBe(22.99)
  })

  it('reports matching when config matches the live server type', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('nodrift', 'cx33')])
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue('cx33')
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(8.99)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/nodrift/cost' })
    const data = res.json() as CostBody

    expect(data.server.liveType).toBe('cx33')
    expect(data.server.driftStatus).toBe('matching')
    expect(data.server.eurPerMonth).toBe(8.99)
  })

  it('does not treat case differences as drift', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('casedrift', 'CX33')])
    vi.mocked(getLiveServerTypeByIp).mockResolvedValue('cx33')
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(8.99)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/casedrift/cost' })
    expect((res.json() as CostBody).server.driftStatus).toBe('matching')
  })

  it('reports unknown when the project has no serverIp', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProjectNoIp])
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.2)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/webapp/cost' })
    const data = res.json() as CostBody

    expect(data.server.liveType).toBeNull()
    expect(data.server.driftStatus).toBe('unknown')
    expect(vi.mocked(getLiveServerTypeByIp)).not.toHaveBeenCalled()
  })

  it('reports unknown, and still prices the configured type, when the live lookup fails', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([projectWithIp('lookupfail', 'cx22')])
    vi.mocked(getLiveServerTypeByIp).mockRejectedValue(new Error('Hetzner unreachable'))
    vi.mocked(getServerTypeMonthlyPrice).mockResolvedValue(5.49)

    await app.register(costRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/lookupfail/cost' })
    expect(res.statusCode).toBe(200)

    const data = res.json() as CostBody
    expect(data.server.liveType).toBeNull()
    expect(data.server.driftStatus).toBe('unknown')
    expect(vi.mocked(getServerTypeMonthlyPrice).mock.calls[0]?.[0]).toBe('cx22')
    expect(data.server.eurPerMonth).toBe(5.49)
  })
})
