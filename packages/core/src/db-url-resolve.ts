import { execa } from 'execa'
import type { PostgresServiceInfo } from './db-scan-compose.js'

/**
 * Handles both `0.0.0.0:PORT` and `127.0.0.1:PORT` forms of `docker compose
 * port` output (and anything else ending in `:<port>`) by only caring about
 * the trailing port digits — the bind address doesn't affect what we build.
 */
export function parseComposePortOutput(raw: string): number {
  const trimmed = raw.trim()
  const match = trimmed.match(/:(\d+)$/)
  if (!match) {
    throw new Error(
      `Could not parse a port from "docker compose port" output: "${trimmed || '(empty)'}"`,
    )
  }
  const port = Number(match[1])
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Parsed an invalid port from "docker compose port" output: "${trimmed}"`)
  }
  return port
}

export type DockerComposePortFn = (
  cwd: string,
  service: string,
  containerPort: number,
) => Promise<string>

export async function dockerComposePort(
  cwd: string,
  service: string,
  containerPort: number,
): Promise<string> {
  const result = await execa('docker', ['compose', 'port', service, String(containerPort)], { cwd })
  return result.stdout
}

/**
 * `queryPort` is injectable so the not-running failure path is unit-testable
 * without Docker — mirrors db-scan-ownership.ts's `verifyContainerOwnership` seam.
 */
export async function resolveHostPort(
  cwd: string,
  service: string,
  containerPort = 5432,
  queryPort: DockerComposePortFn = dockerComposePort,
): Promise<number> {
  let stdout: string
  try {
    stdout = await queryPort(cwd, service, containerPort)
  } catch (err) {
    throw new Error(
      `Could not resolve the "${service}" service's port — is the container running? Run \`docker compose up -d\`.\n${(err as Error).message}`,
      { cause: err },
    )
  }
  if (!stdout.trim()) {
    throw new Error(
      `"docker compose port ${service} ${containerPort}" returned nothing — the container is not running. Run \`docker compose up -d\`.`,
    )
  }
  return parseComposePortOutput(stdout)
}

export function buildDatabaseUrl(
  postgres: PostgresServiceInfo,
  hostPort: number,
  host = 'localhost',
): string {
  const { user, password, database } = postgres
  const missing = [
    !user && 'POSTGRES_USER',
    !password && 'POSTGRES_PASSWORD',
    !database && 'POSTGRES_DB',
  ].filter((v): v is string => Boolean(v))
  if (missing.length > 0) {
    throw new Error(
      `Compose service "${postgres.serviceName}" is missing ${missing.join(', ')} — cannot build a database URL.`,
    )
  }
  return `postgres://${encodeURIComponent(user as string)}:${encodeURIComponent(password as string)}@${host}:${hostPort}/${encodeURIComponent(database as string)}`
}
