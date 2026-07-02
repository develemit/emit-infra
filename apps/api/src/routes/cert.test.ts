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
import { certRoutes } from './cert.js'

const mockProject = {
  config: {
    name: 'myapp',
    domain: 'example.com',
    region: 'nbg1' as const,
    serverType: 'cx22',
    sshKeyName: 'emit-deploy',
    github: { repo: 'user/myapp' },
  },
  configPath: '/projects/myapp/.emit-infra.json',
  projectDir: '/projects/myapp',
}

// Realistic openssl output with SANs and timer
const MOCK_OPENSSL_OUTPUT = [
  'issuer=C=US, O=Let\'s Encrypt, CN=R11',
  'subject=CN=example.com',
  'serial=03ABC12345DEF',
  'notBefore=Jan  1 00:00:00 2025 GMT',
  'notAfter=Apr  1 00:00:00 2025 GMT',
  'X509v3 Subject Alternative Name:',
  '    DNS:example.com, DNS:www.example.com',
  'LastTriggerUSec=1735689600000000',
].join('\n')

describe('GET /projects/:name/cert-details', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    await app.register(certRoutes)
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('returns 404 when project is not found', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/projects/missing/cert-details' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('returns 503 when SSH is unreachable', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'))

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cert-details' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'unreachable' })
  })

  it('returns 404 cert not found when SSH output has no serial or issuer', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue('timer-unavailable')

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cert-details' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'cert not found' })
  })

  it('returns parsed cert details on happy path', async () => {
    vi.mocked(discoverProjects).mockResolvedValue([mockProject])
    vi.mocked(sshExec).mockResolvedValue(MOCK_OPENSSL_OUTPUT)

    const res = await app.inject({ method: 'GET', url: '/projects/myapp/cert-details' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      issuer: string
      subject: string
      serial: string
      sans: string[]
      daysUntilExpiry: number
      renewTimerLastRan: string | null
    }
    expect(data.issuer).toContain('Let\'s Encrypt')
    expect(data.subject).toContain('example.com')
    expect(data.serial).toBe('03ABC12345DEF')
    expect(data.sans).toContain('example.com')
    expect(data.sans).toContain('www.example.com')
    expect(typeof data.daysUntilExpiry).toBe('number')
    expect(data.renewTimerLastRan).not.toBeNull()
  })
})
