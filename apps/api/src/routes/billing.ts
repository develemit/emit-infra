import type { FastifyInstance } from 'fastify'
import { createTtlCache } from '../lib/ttl-cache.js'

const BILLING_TTL = 3_600_000

type ServerLineItem = {
  type: 'server'
  name: string
  serverRate: number
  ipv4Rate: number
  monthlyRate: number
  spendToDate: number
}

type FloatingIpLineItem = {
  type: 'floating_ip'
  name: string
  monthlyRate: number
  spendToDate: number
}

type BillingLineItem = ServerLineItem | FloatingIpLineItem

type BillingResponse = {
  month: string
  spendToDate: number
  projectedMonthly: number
  currency: 'EUR'
  breakdown: BillingLineItem[]
  fetchedAt: string
}

type HetznerPrice = {
  location: string
  price_hourly?: { gross: string }
  price_monthly: { gross: string }
}

type HetznerServer = {
  id: number
  name: string
  location: { name: string }
  public_net: { ipv4: { id: number } | null }
  server_type: {
    prices: HetznerPrice[]
  }
}

type HetznerFloatingIp = {
  id: number
  ip: string
  type: string
  name?: string | null
  description?: string | null
  home_location: { name: string }
}

type HetznerPricing = {
  primary_ips: Array<{
    type: string
    prices: HetznerPrice[]
  }>
  floating_ips?: Array<{
    type: string
    prices: HetznerPrice[]
  }>
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

/**
 * Hetzner bills hourly but never charges more than the monthly price for a
 * resource, so hourly × a full month overshoots the real invoice. Without the
 * cap, spend-to-date can exceed the monthly projection — which is impossible on
 * a real bill and was the tell that this was wrong.
 */
export function cappedSpend(hourlyRate: number, monthlyRate: number, hoursElapsed: number): number {
  return Math.min(hourlyRate * hoursElapsed, monthlyRate)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function priceForLocation(prices: HetznerPrice[], location: string): HetznerPrice | undefined {
  return prices.find((p) => p.location === location) ?? prices[0]
}

function buildServerLineItem(
  server: HetznerServer,
  ipv4Prices: HetznerPrice[],
  hours: number,
): ServerLineItem {
  const loc = server.location.name
  const serverPrice = priceForLocation(server.server_type.prices, loc)
  const serverMonthly = parseFloat(serverPrice?.price_monthly.gross ?? '0')
  const serverHourly = parseFloat(serverPrice?.price_hourly?.gross ?? '0')

  const hasIpv4 = server.public_net.ipv4 !== null
  const ipPrice = hasIpv4 ? priceForLocation(ipv4Prices, loc) : undefined
  const ipMonthly = parseFloat(ipPrice?.price_monthly.gross ?? '0')
  const ipHourly = parseFloat(ipPrice?.price_hourly?.gross ?? '0')

  const monthlyRate = serverMonthly + ipMonthly
  const spend = cappedSpend(serverHourly + ipHourly, monthlyRate, hours)

  return {
    type: 'server',
    name: server.name,
    serverRate: round2(serverMonthly),
    ipv4Rate: round2(ipMonthly),
    monthlyRate: round2(monthlyRate),
    spendToDate: round2(spend),
  }
}

function buildFloatingIpLineItem(
  ip: HetznerFloatingIp,
  floatingPrices: HetznerPrice[],
  hours: number,
  hoursInMonth: number,
): FloatingIpLineItem {
  const price = priceForLocation(floatingPrices, ip.home_location.name)
  const monthlyRate = parseFloat(price?.price_monthly.gross ?? '0')

  // Floating-IP pricing exposes only a monthly figure (no price_hourly), so
  // prorate across the month rather than reading an hourly rate that isn't there.
  const impliedHourly = hoursInMonth > 0 ? monthlyRate / hoursInMonth : 0

  return {
    type: 'floating_ip',
    name: ip.description?.trim() || ip.name?.trim() || ip.ip,
    monthlyRate: round2(monthlyRate),
    spendToDate: round2(cappedSpend(impliedHourly, monthlyRate, hours)),
  }
}

async function fetchBilling(token: string): Promise<BillingResponse> {
  const headers = { Authorization: `Bearer ${token}` }
  const opts = { headers, signal: AbortSignal.timeout(10000) }

  const [serversRes, pricingRes, floatingIpsRes] = await Promise.all([
    fetch('https://api.hetzner.cloud/v1/servers?per_page=50', opts),
    fetch('https://api.hetzner.cloud/v1/pricing', opts),
    fetch('https://api.hetzner.cloud/v1/floating_ips?per_page=50', opts),
  ])

  if (!serversRes.ok) throw new Error(`Hetzner servers API ${serversRes.status}`)
  if (!pricingRes.ok) throw new Error(`Hetzner pricing API ${pricingRes.status}`)
  if (!floatingIpsRes.ok) throw new Error(`Hetzner floating IPs API ${floatingIpsRes.status}`)

  const { servers } = (await serversRes.json()) as { servers: HetznerServer[] }
  const { pricing } = (await pricingRes.json()) as { pricing: HetznerPricing }
  const { floating_ips: floatingIps = [] } = (await floatingIpsRes.json()) as {
    floating_ips?: HetznerFloatingIp[]
  }

  const ipv4Prices = pricing.primary_ips.find((p) => p.type === 'ipv4')?.prices ?? []
  const floatingIpv4Prices = pricing.floating_ips?.find((p) => p.type === 'ipv4')?.prices ?? []

  const { hours, hoursInMonth } = hoursElapsedThisMonth()

  const breakdown: BillingLineItem[] = [
    ...servers.map((server) => buildServerLineItem(server, ipv4Prices, hours)),
    ...floatingIps.map((ip) => buildFloatingIpLineItem(ip, floatingIpv4Prices, hours, hoursInMonth)),
  ]

  const now = new Date()

  return {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    spendToDate: round2(breakdown.reduce((s, b) => s + b.spendToDate, 0)),
    projectedMonthly: round2(breakdown.reduce((s, b) => s + b.monthlyRate, 0)),
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
