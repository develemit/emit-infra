import { createTtlCache } from './ttl-cache.js'

interface HetznerServerType {
  name: string
  prices: Array<{
    location: string
    price_monthly: {
      net: string
    }
  }>
}

interface HetznerResponse {
  server_types: HetznerServerType[]
}

const HETZNER_API_URL = 'https://api.hetzner.cloud/v1/server_types'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const FETCH_TIMEOUT_MS = 10_000

const serverTypesCache = createTtlCache<HetznerServerType[]>(CACHE_TTL_MS)
const CACHE_KEY = '__server_types__'

async function fetchServerTypes(): Promise<HetznerServerType[] | null> {
  const token = process.env['HETZNER_API_TOKEN']
  if (!token) return null

  const cached = serverTypesCache.get(CACHE_KEY)
  if (cached !== undefined) return cached

  try {
    const response = await fetch(HETZNER_API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(`[hetzner] API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = (await response.json()) as HetznerResponse
    const serverTypes = data.server_types
    serverTypesCache.set(CACHE_KEY, serverTypes)
    return serverTypes
  } catch (error) {
    console.error('[hetzner] fetch error:', error)
    return null
  }
}

export async function getServerTypeMonthlyPrice(
  serverType: string,
  region: string,
): Promise<number | null> {
  const token = process.env['HETZNER_API_TOKEN']
  if (!token) return null

  const serverTypes = await fetchServerTypes()
  if (!serverTypes) return null

  const type = serverTypes.find((st) => st.name.toLowerCase() === serverType.toLowerCase())
  if (!type) return null

  // Find price for the region, or fall back to the first location
  const regionPrice = type.prices.find((p) => p.location === region)
  const price = regionPrice ?? type.prices[0]

  if (!price) return null

  return parseFloat(price.price_monthly.net)
}
