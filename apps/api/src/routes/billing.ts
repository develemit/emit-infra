import type { FastifyInstance } from 'fastify'
import { createTtlCache } from '../lib/ttl-cache.js'

const BILLING_TTL = 3_600_000

type BillingLineItem = {
  type: 'server'
  name: string
  serverRate: number
  ipv4Rate: number
  monthlyRate: number
  spendToDate: number
}

type BillingResponse = {
  month: string
  spendToDate: number
  projectedMonthly: number
  currency: 'EUR'
  breakdown: BillingLineItem[]
  fetchedAt: string
}

type HetznerServer = {
  id: number
  name: string
  datacenter: { location: { name: string } }
  server_type: {
    prices: Array<{
      location: string
      price_hourly: { gross: string }
      price_monthly: { gross: string }
    }>
  }
}

type HetznerPrimaryIp = {
  id: number
  assignee_id: number | null
  assignee_type: string
  prices: Array<{ location: string; price_monthly: { gross: string } }>
}

const billingCache = createTtlCache<BillingResponse | { error: string }>(BILLING_TTL)

function hoursElapsedThisMonth(): { hours: number; hoursInMonth: number } {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return {
    hours: (now.getTime() - startOfMonth.getTime()) / 3_600_000,
    hoursInMonth: daysInMonth * 24,
  }
}

async function fetchBilling(token: string): Promise<BillingResponse> {
  const headers = { Authorization: `Bearer ${token}` }
  const opts = { headers, signal: AbortSignal.timeout(10000) }

  const [serversRes, ipsRes] = await Promise.all([
    fetch('https://api.hetzner.cloud/v1/servers?per_page=50', opts),
    fetch('https://api.hetzner.cloud/v1/primary_ips?per_page=50', opts),
  ])

  if (!serversRes.ok) throw new Error(`Hetzner servers API ${serversRes.status}`)
  if (!ipsRes.ok) throw new Error(`Hetzner primary_ips API ${ipsRes.status}`)

  const { servers } = (await serversRes.json()) as { servers: HetznerServer[] }
  const { primary_ips } = (await ipsRes.json()) as { primary_ips: HetznerPrimaryIp[] }

  const { hours, hoursInMonth } = hoursElapsedThisMonth()

  const breakdown = servers.map((server) => {
    const loc = server.datacenter.location.name
    const serverPrice = server.server_type.prices.find((p) => p.location === loc)
    const serverMonthly = parseFloat(serverPrice?.price_monthly.gross ?? '0')
    const serverHourly = parseFloat(serverPrice?.price_hourly.gross ?? '0')

    const primaryIp = primary_ips.find(
      (ip) => ip.assignee_type === 'server' && ip.assignee_id === server.id,
    )
    const ipPrice = primaryIp?.prices.find((p) => p.location === loc) ?? primaryIp?.prices[0]
    const ipMonthly = parseFloat(ipPrice?.price_monthly.gross ?? '0')
    const ipHourly = ipMonthly / hoursInMonth

    const spend = serverHourly * hours + ipHourly * hours

    return {
      type: 'server' as const,
      name: server.name,
      serverRate: Math.round(serverMonthly * 100) / 100,
      ipv4Rate: Math.round(ipMonthly * 100) / 100,
      monthlyRate: Math.round((serverMonthly + ipMonthly) * 100) / 100,
      spendToDate: Math.round(spend * 100) / 100,
    }
  })

  const now = new Date()
  const spendToDate = Math.round(breakdown.reduce((s, b) => s + b.spendToDate, 0) * 100) / 100
  const projectedMonthly =
    Math.round(breakdown.reduce((s, b) => s + b.monthlyRate, 0) * 100) / 100

  return {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    spendToDate,
    projectedMonthly,
    currency: 'EUR',
    breakdown,
    fetchedAt: now.toISOString(),
  }
}

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/hetzner', async () => {
    const token = process.env['HCLOUD_TOKEN']
    if (!token) return { error: 'unavailable' }

    const cached = billingCache.get('hetzner')
    if (cached !== undefined) return cached

    try {
      const result = await fetchBilling(token)
      billingCache.set('hetzner', result)
      return result
    } catch {
      return { error: 'unavailable' }
    }
  })
}
