import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface PostgresServiceInfo {
  serviceName: string
  containerName: string | null
  hostPort: number | null
  isEphemeral: boolean
  user: string | null
  password: string | null
  database: string | null
}

const COMPOSE_FILENAMES = ['docker-compose.yml', 'compose.yaml', 'compose.yml']
const COMPOSE_SEARCH_DIRS = ['', 'docker']

/**
 * Root is checked before the nested `docker/` dir (martialops keeps its
 * compose file there), and within each dir the three filename styles are
 * checked in the order above — the fleet has all three (emit-billing:
 * docker-compose.yml, tastease: compose.yaml).
 */
export function findComposeFile(repoPath: string): string | null {
  for (const dir of COMPOSE_SEARCH_DIRS) {
    for (const filename of COMPOSE_FILENAMES) {
      const relative = dir ? join(dir, filename) : filename
      if (existsSync(join(repoPath, relative))) return relative
    }
  }
  return null
}

// Compose interpolation (`${VAR:-default}`) is normally resolved from the
// shell environment at `docker compose` invocation time. This scanner has no
// environment to consult, so it resolves only the literal default — good
// enough to reproduce the fleet's declared config, and the same fallback
// `docker compose` itself uses when the variable is unset.
function resolveInterpolations(str: string): string {
  return str.replace(/\$\{[A-Za-z0-9_]+(:-(.*?))?\}/g, (_match, _hasDefault, def) => def ?? '')
}

export function parsePortEntry(raw: string): { hostPort: number | null; isEphemeral: boolean } {
  const resolved = resolveInterpolations(String(raw).trim())
  const containerMatch = resolved.match(/:(\d+)$/)
  if (!containerMatch) {
    // bare container port ("5432") or an unresolved var with no default —
    // either way, no fixed host port is declared.
    return { hostPort: null, isEphemeral: true }
  }

  const hostSpec = resolved.slice(0, resolved.length - containerMatch[0].length)
  if (hostSpec === '') return { hostPort: null, isEphemeral: true }

  const lastColon = hostSpec.lastIndexOf(':')
  const hostPortRaw = lastColon >= 0 ? hostSpec.slice(lastColon + 1) : hostSpec
  if (hostPortRaw === '') return { hostPort: null, isEphemeral: true } // e.g. '127.0.0.1::5432'

  const port = Number(hostPortRaw)
  if (!Number.isInteger(port) || port <= 0) return { hostPort: null, isEphemeral: false }
  return { hostPort: port, isEphemeral: false }
}

function extractEnvValue(environment: unknown, key: string): string | null {
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      if (typeof entry !== 'string') continue
      const eq = entry.indexOf('=')
      if (eq < 0) continue
      if (entry.slice(0, eq) !== key) continue
      const value = resolveInterpolations(entry.slice(eq + 1))
      return value.length > 0 ? value : null
    }
    return null
  }
  if (environment && typeof environment === 'object') {
    const raw = (environment as Record<string, unknown>)[key]
    if (raw === undefined || raw === null) return null
    const value = resolveInterpolations(String(raw))
    return value.length > 0 ? value : null
  }
  return null
}

function isPostgresImage(image: unknown): boolean {
  return typeof image === 'string' && /^postgres[:@]/i.test(image)
}

function buildServiceInfo(serviceName: string, svc: Record<string, unknown>): PostgresServiceInfo {
  const ports = Array.isArray(svc['ports'])
    ? (svc['ports'] as unknown[]).filter((p): p is string => typeof p === 'string')
    : []
  const portInfo =
    ports[0] !== undefined ? parsePortEntry(ports[0]) : { hostPort: null, isEphemeral: true }

  return {
    serviceName,
    containerName:
      typeof svc['container_name'] === 'string' ? (svc['container_name'] as string) : null,
    hostPort: portInfo.hostPort,
    isEphemeral: portInfo.isEphemeral,
    user: extractEnvValue(svc['environment'], 'POSTGRES_USER'),
    password: extractEnvValue(svc['environment'], 'POSTGRES_PASSWORD'),
    database: extractEnvValue(svc['environment'], 'POSTGRES_DB'),
  }
}

function getServices(parsed: unknown): Record<string, unknown> | null {
  const services = (parsed as { services?: unknown } | null)?.services
  return services && typeof services === 'object' ? (services as Record<string, unknown>) : null
}

export function extractPostgresService(parsed: unknown): PostgresServiceInfo | null {
  const services = getServices(parsed)
  if (!services) return null

  let picked: [string, Record<string, unknown>] | null = null
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') continue
    const service = svc as Record<string, unknown>
    if (name === 'postgres') {
      picked = [name, service]
      break
    }
    if (!picked && isPostgresImage(service['image'])) picked = [name, service]
  }
  if (!picked) return null
  return buildServiceInfo(picked[0], picked[1])
}

// Unlike extractPostgresService's "postgres" name / postgres:* image auto-detect
// (built for db-doctor's arbitrary-repo scan), this looks up one exact service
// name — what db-url needs when a repo names its service something else (e.g.
// tastease's `db`) and the caller already knows which one it wants.
export function extractServiceByName(
  parsed: unknown,
  serviceName: string,
): PostgresServiceInfo | null {
  const services = getServices(parsed)
  const svc = services?.[serviceName]
  if (!svc || typeof svc !== 'object') return null
  return buildServiceInfo(serviceName, svc as Record<string, unknown>)
}

function readAndParseCompose(repoPath: string): { relative: string; parsed: unknown } | null {
  const relative = findComposeFile(repoPath)
  if (!relative) return null
  const content = readFileSync(join(repoPath, relative), 'utf-8')
  return { relative, parsed: parseYaml(content) }
}

export function parseRepoCompose(repoPath: string): {
  composeFile: string | null
  postgres: PostgresServiceInfo | null
} {
  const found = readAndParseCompose(repoPath)
  if (!found) return { composeFile: null, postgres: null }
  return { composeFile: found.relative, postgres: extractPostgresService(found.parsed) }
}

export function parseRepoComposeService(
  repoPath: string,
  serviceName: string,
): { composeFile: string | null; postgres: PostgresServiceInfo | null } {
  const found = readAndParseCompose(repoPath)
  if (!found) return { composeFile: null, postgres: null }
  return { composeFile: found.relative, postgres: extractServiceByName(found.parsed, serviceName) }
}
