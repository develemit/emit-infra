import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../lib/ttl-cache.js', () => ({
  createTtlCache: () => ({ get: () => undefined, set: () => {} }),
}))

import { billingRoutes, cappedSpend } from './billing.js'

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
          location: { name: 'nbg1' },
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
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ floating_ips: [] }),
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

  it('caps spend at the monthly price and includes floating IPs in the totals', async () => {
    process.env['HCLOUD_TOKEN'] = 'test-token'

    const mockServers = {
      servers: [
        {
          id: 1,
          name: 'capped-server',
          location: { name: 'nbg1' },
          public_net: { ipv4: { id: 100 } },
          server_type: {
            prices: [
              {
                location: 'nbg1',
                // Deliberately large hourly rate so hourly x elapsed hours
                // blows past the monthly cap within the first day.
                price_hourly: { gross: '1.00' },
                price_monthly: { gross: '8.99' },
              },
            ],
          },
        },
      ],
    }

    const mockPricing = {
      pricing: {
        primary_ips: [
          {
            type: 'ipv4',
            prices: [
              {
                location: 'nbg1',
                price_hourly: { gross: '0.001' },
                price_monthly: { gross: '0.60' },
              },
            ],
          },
        ],
        // Floating-IP pricing carries no price_hourly — only monthly.
        floating_ips: [
          { type: 'ipv4', prices: [{ location: 'nbg1', price_monthly: { gross: '3.50' } }] },
        ],
      },
    }

    const mockFloatingIps = {
      floating_ips: [
        {
          id: 7,
          ip: '46.225.249.8',
          type: 'ipv4',
          name: 'floating_ip-133753856',
          description: 'emit-vision production static IP',
          home_location: { name: 'nbg1' },
        },
      ],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockServers) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockPricing) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockFloatingIps) }),
    )

    const res = await app.inject({ method: 'GET', url: '/billing/hetzner' })
    expect(res.statusCode).toBe(200)

    const data = res.json() as {
      spendToDate: number
      projectedMonthly: number
      breakdown: Array<{ type: string; name: string; monthlyRate: number; spendToDate: number }>
    }

    const server = data.breakdown.find((b) => b.type === 'server')
    const floatingIp = data.breakdown.find((b) => b.type === 'floating_ip')
    if (!server || !floatingIp) throw new Error('expected both a server and a floating-IP item')

    expect(floatingIp.name).toBe('emit-vision production static IP')
    expect(floatingIp.monthlyRate).toBeCloseTo(3.5, 2)

    // The cap is the point: an uncapped hourly rate would far exceed these.
    expect(server.spendToDate).toBeLessThanOrEqual(server.monthlyRate)
    expect(floatingIp.spendToDate).toBeLessThanOrEqual(floatingIp.monthlyRate)

    // Spend exceeding the projection is impossible on a real Hetzner invoice.
    expect(data.spendToDate).toBeLessThanOrEqual(data.projectedMonthly)

    // Reported totals are exactly the sum of the reported line items.
    expect(data.projectedMonthly).toBeCloseTo(
      data.breakdown.reduce((s, b) => s + b.monthlyRate, 0),
      2,
    )
    expect(data.spendToDate).toBeCloseTo(
      data.breakdown.reduce((s, b) => s + b.spendToDate, 0),
      2,
    )
    expect(data.projectedMonthly).toBeCloseTo(8.99 + 0.6 + 3.5, 2)
  })

  it('falls back to the IP address when a floating IP has no description', async () => {
    process.env['HCLOUD_TOKEN'] = 'test-token'

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ servers: [] }) })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              pricing: {
                primary_ips: [],
                floating_ips: [
                  { type: 'ipv4', prices: [{ location: 'nbg1', price_monthly: { gross: '3.50' } }] },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              floating_ips: [
                {
                  id: 8,
                  ip: '1.2.3.4',
                  type: 'ipv4',
                  name: null,
                  description: '   ',
                  home_location: { name: 'nbg1' },
                },
              ],
            }),
        }),
    )

    const res = await app.inject({ method: 'GET', url: '/billing/hetzner' })
    const data = res.json() as { breakdown: Array<{ name: string }> }

    expect(data.breakdown[0]?.name).toBe('1.2.3.4')
  })
})

describe('cappedSpend', () => {
  it('returns hourly x hours while under the monthly cap', () => {
    expect(cappedSpend(0.0104, 6.49, 100)).toBeCloseTo(1.04, 4)
  })

  it('returns the cap once hourly x hours exceeds it', () => {
    // cx23: €0.0104/h x 744h = €7.74, but Hetzner never charges above €6.49.
    expect(cappedSpend(0.0104, 6.49, 744)).toBe(6.49)
  })

  it('returns the cap exactly at the crossover point', () => {
    expect(cappedSpend(0.0104, 6.49, 6.49 / 0.0104)).toBeCloseTo(6.49, 6)
  })

  it('never exceeds the cap for any elapsed hours', () => {
    for (const hours of [0, 1, 100, 744, 10_000]) {
      expect(cappedSpend(0.0368, 22.99, hours)).toBeLessThanOrEqual(22.99)
    }
  })

  it('is zero before any hours have elapsed', () => {
    expect(cappedSpend(0.0104, 6.49, 0)).toBe(0)
  })
})
