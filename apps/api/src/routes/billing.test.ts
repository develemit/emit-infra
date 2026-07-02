import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {} }),
}))

import { billingRoutes } from './billing.js'

describe('GET /billing/hetzner', () => {
  let app: FastifyInstance
  const originalToken = process.env['HCLOUD_TOKEN']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    app = Fastify({ logger: false })
    await app.register(billingRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllEnvs()
    if (originalToken !== undefined) {
      process.env['HCLOUD_TOKEN'] = originalToken
    } else {
      delete process.env['HCLOUD_TOKEN']
    }
    vi.unstubAllGlobals()
  })

  it('returns error: unavailable when HCLOUD_TOKEN is not set', async () => {
    delete process.env['HCLOUD_TOKEN']

    const res = await app.inject({ method: 'GET', url: '/billing/hetzner' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ error: 'unavailable' })
  })

  it('returns error: unavailable when Hetzner API fetch fails', async () => {
    process.env['HCLOUD_TOKEN'] = 'test-token'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const res = await app.inject({ method: 'GET', url: '/billing/hetzner' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ error: 'unavailable' })
  })

  it('returns billing summary on happy path', async () => {
    process.env['HCLOUD_TOKEN'] = 'test-token'

    const mockServersResponse = {
      servers: [
        {
          id: 1,
          name: 'myapp-server',
          datacenter: { location: { name: 'nbg1' } },
          public_net: { ipv4: { id: 100 } },
          server_type: {
            prices: [
              {
                location: 'nbg1',
                price_hourly: { gross: '0.00595' },
                price_monthly: { gross: '3.79' },
              },
            ],
          },
        },
      ],
    }

    const mockPricingResponse = {
      pricing: {
        primary_ips: [
          {
            type: 'ipv4',
            prices: [
              {
                location: 'nbg1',
                price_hourly: { gross: '0.000595' },
                price_monthly: { gross: '0.38' },
              },
            ],
          },
        ],
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockServersResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPricingResponse),
        }),
    )

    const res = await app.inject({ method: 'GET', url: '/billing/hetzner' })

    expect(res.statusCode).toBe(200)
    const data = res.json() as {
      month: string
      currency: string
      breakdown: Array<{ name: string; type: string; monthlyRate: number }>
    }
    expect(data.currency).toBe('EUR')
    expect(data.month).toMatch(/^\d{4}-\d{2}$/)
    expect(data.breakdown).toHaveLength(1)
    expect(data.breakdown[0]?.name).toBe('myapp-server')
    expect(data.breakdown[0]?.type).toBe('server')
    expect(data.breakdown[0]?.monthlyRate).toBeCloseTo(4.17, 1)
  })
})
