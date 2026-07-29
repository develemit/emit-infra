import { createTtlCache } from './ttl-cache.js'

interface HetznerServerType {
  name: string
  prices: Array<{
    location: string
    price_monthly: {
      net: string
      gross: string
    }
  }>
}

interface HetznerServer {
  name: string
  public_net: { ipv4: { ip: string } | null }
  server_type: { name: string }
}

interface HetznerServerTypesResponse {
  server_types: HetznerServerType[]
}

interface HetznerServersResponse {
  servers: HetznerServer[]
}

const SERVER_TYPES_URL = 'https://api.hetzner.cloud/v1/server_types'
const SERVERS_URL = 'https://api.hetzner.cloud/v1/servers?per_page=50'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours — published prices rarely move
const SERVERS_TTL_MS = 60 * 60 * 1000 // 1 hour — a rescale should surface promptly
const FETCH_TIMEOUT_MS = 10_000

const serverTypesCache = createTtlCache<HetznerServerType[]>(CACHE_TTL_MS)
const serversCache = createTtlCache<HetznerServer[]>(SERVERS_TTL_MS)
const CACHE_KEY = '__server_types__'
const SERVERS_CACHE_KEY = '__servers__'

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  const token = process.env['HCLOUD_TOKEN']
  if (!token) return null

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(`[hetzner] ${label} API error: ${response.status} ${response.statusText}`)
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.error(`[hetzner] ${label} fetch error:`, error)
    return null
  }
}

async function fetchServerTypes(): Promise<HetznerServerType[] | null> {
  const cached = serverTypesCache.get(CACHE_KEY)
  if (cached !== undefined) return cached

  const data = await fetchJson<HetznerServerTypesResponse>(SERVER_TYPES_URL, 'server_types')
  if (!data) return null

  serverTypesCache.set(CACHE_KEY, data.server_types)
  return data.server_types
}

async function fetchServers(): Promise<HetznerServer[] | null> {
  const cached = serversCache.get(SERVERS_CACHE_KEY)
  if (cached !== undefined) return cached

  const data = await fetchJson<HetznerServersResponse>(SERVERS_URL, 'servers')
  if (!data) return null

  serversCache.set(SERVERS_CACHE_KEY, data.servers)
  return data.servers
}

/**
 * Returns the gross (VAT-inclusive) monthly price. Gross matches what Hetzner
 * actually invoices and what the billing widget reports, so both cost surfaces
 * agree on units.
 */
export async function getServerTypeMonthlyPrice(
  serverType: string,
  region: string,
): Promise<number | null> {
  const serverTypes = await fetchServerTypes()
  if (!serverTypes) return null

  const type = serverTypes.find((st) => st.name.toLowerCase() === serverType.toLowerCase())
  if (!type) return null

  // Find price for the region, or fall back to the first location
  const regionPrice = type.prices.find((p) => p.location === region)
  const price = regionPrice ?? type.prices[0]

  if (!price) return null

  return parseFloat(price.price_monthly.gross)
}

/**
 * Resolves the server type Hetzner actually reports for the box at `ip`, so a
 * stale `serverType` in project config can be detected instead of silently
 * priced. Matched by IP rather than name because a project's name and its
 * server's name routinely differ (project `emit-vision` runs `emit-vision-prod`).
 */
export async function getLiveServerTypeByIp(ip: string): Promise<string | null> {
  const servers = await fetchServers()
  if (!servers) return null

  const match = servers.find((s) => s.public_net.ipv4?.ip === ip)
  return match?.server_type.name ?? null
}
