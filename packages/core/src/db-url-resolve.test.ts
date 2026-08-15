import { describe, it, expect } from 'vitest'
import { parseComposePortOutput, resolveHostPort, buildDatabaseUrl } from './db-url-resolve.js'
import type { PostgresServiceInfo } from './db-scan-compose.js'

describe('parseComposePortOutput', () => {
  it('parses the 0.0.0.0:PORT form', () => {
    expect(parseComposePortOutput('0.0.0.0:54321')).toBe(54321)
  })

  it('parses the 127.0.0.1:PORT form', () => {
    expect(parseComposePortOutput('127.0.0.1:54321\n')).toBe(54321)
  })

  it('throws on empty output', () => {
    expect(() => parseComposePortOutput('')).toThrow(/Could not parse a port/)
  })

  it('throws on malformed output with no trailing port', () => {
    expect(() => parseComposePortOutput('not a port mapping')).toThrow(/Could not parse a port/)
  })

  it('throws on an out-of-range port', () => {
    expect(() => parseComposePortOutput('0.0.0.0:999999')).toThrow(/invalid port/)
  })
})

describe('resolveHostPort', () => {
  it('parses the port from a successful query', async () => {
    const queryPort = async () => '0.0.0.0:54321\n'
    await expect(resolveHostPort('/repo', 'postgres', 5432, queryPort)).resolves.toBe(54321)
  })

  it('names the fix when the container is not running (query rejects)', async () => {
    const queryPort = async () => {
      throw new Error('no such service: postgres')
    }
    await expect(resolveHostPort('/repo', 'postgres', 5432, queryPort)).rejects.toThrow(
      /is the container running\? Run `docker compose up -d`/,
    )
  })

  it('names the fix when the container is not running (empty stdout)', async () => {
    const queryPort = async () => ''
    await expect(resolveHostPort('/repo', 'postgres', 5432, queryPort)).rejects.toThrow(
      /the container is not running/,
    )
  })

  it('passes the service name and container port through to queryPort', async () => {
    let seen: [string, string, number] | null = null
    const queryPort = async (cwd: string, service: string, port: number) => {
      seen = [cwd, service, port]
      return '0.0.0.0:1234'
    }
    await resolveHostPort('/repo', 'db', 5432, queryPort)
    expect(seen).toEqual(['/repo', 'db', 5432])
  })
})

function postgres(overrides: Partial<PostgresServiceInfo> = {}): PostgresServiceInfo {
  return {
    serviceName: 'postgres',
    containerName: null,
    hostPort: null,
    isEphemeral: true,
    user: 'app',
    password: 'secret',
    database: 'app_dev',
    ...overrides,
  }
}

describe('buildDatabaseUrl', () => {
  it('builds a connectable-shaped URL from full credentials', () => {
    expect(buildDatabaseUrl(postgres(), 54321)).toBe(
      'postgres://app:secret@localhost:54321/app_dev',
    )
  })

  it('URL-encodes credentials with special characters', () => {
    const url = buildDatabaseUrl(postgres({ user: 'a b', password: 'p@ss' }), 54321)
    expect(url).toBe('postgres://a%20b:p%40ss@localhost:54321/app_dev')
  })

  it('throws naming each missing credential', () => {
    expect(() => buildDatabaseUrl(postgres({ user: null, database: null }), 54321)).toThrow(
      /POSTGRES_USER.*POSTGRES_DB/s,
    )
  })
})
