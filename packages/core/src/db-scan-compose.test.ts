import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findComposeFile, parsePortEntry, extractPostgresService, parseRepoCompose } from './db-scan-compose.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'db-scan.fixtures')

const tmpDirs: string[] = []

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'db-scan-compose-test-'))
  tmpDirs.push(dir)
  for (const [relative, fixtureName] of Object.entries(files)) {
    const dest = join(dir, relative)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, readFileSync(join(FIXTURES_DIR, fixtureName), 'utf-8'))
  }
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

describe('findComposeFile', () => {
  it('finds docker-compose.yml at the repo root', () => {
    const repo = makeRepo({ 'docker-compose.yml': 'ephemeral.docker-compose.yml' })
    expect(findComposeFile(repo)).toBe('docker-compose.yml')
  })

  it('finds compose.yaml at the repo root', () => {
    const repo = makeRepo({ 'compose.yaml': 'fixed-interpolated.compose.yaml' })
    expect(findComposeFile(repo)).toBe('compose.yaml')
  })

  it('finds compose.yml at the repo root', () => {
    const repo = makeRepo({ 'compose.yml': 'fixed-default-port.compose.yml' })
    expect(findComposeFile(repo)).toBe('compose.yml')
  })

  it('finds a compose file nested one level under docker/', () => {
    const repo = makeRepo({ 'docker/docker-compose.yml': 'nested.docker-compose.yml' })
    expect(findComposeFile(repo)).toBe(join('docker', 'docker-compose.yml'))
  })

  it('prefers the root file over a nested one when both exist', () => {
    const repo = makeRepo({
      'docker-compose.yml': 'ephemeral.docker-compose.yml',
      'docker/docker-compose.yml': 'nested.docker-compose.yml',
    })
    expect(findComposeFile(repo)).toBe('docker-compose.yml')
  })

  it('returns null when no compose file exists', () => {
    const repo = mkdtempSync(join(tmpdir(), 'db-scan-compose-test-'))
    tmpDirs.push(repo)
    expect(findComposeFile(repo)).toBeNull()
  })
})

describe('parsePortEntry', () => {
  it('parses a fixed host:container mapping', () => {
    expect(parsePortEntry('5440:5432')).toEqual({ hostPort: 5440, isEphemeral: false })
  })

  it('treats a bind-address-only mapping (double colon) as ephemeral', () => {
    expect(parsePortEntry('127.0.0.1::5432')).toEqual({ hostPort: null, isEphemeral: true })
  })

  it('treats a bare container port as ephemeral', () => {
    expect(parsePortEntry('5432')).toEqual({ hostPort: null, isEphemeral: true })
  })

  it('parses a bind-address:host:container mapping', () => {
    expect(parsePortEntry('127.0.0.1:5440:5432')).toEqual({ hostPort: 5440, isEphemeral: false })
  })

  it('resolves ${VAR:-default} interpolation in the host port', () => {
    expect(parsePortEntry('${E2E_PG_PORT:-5436}:5432')).toEqual({ hostPort: 5436, isEphemeral: false })
  })

  it('treats an unresolvable var with no default as not-ephemeral-but-unknown', () => {
    expect(parsePortEntry('${SOME_VAR}:5432')).toEqual({ hostPort: null, isEphemeral: true })
  })
})

describe('extractPostgresService', () => {
  it('returns null when there is no services key', () => {
    expect(extractPostgresService({})).toBeNull()
  })

  it('returns null when no service looks like postgres', () => {
    expect(extractPostgresService({ services: { redis: { image: 'redis:7-alpine' } } })).toBeNull()
  })

  it('matches a service literally named postgres even without an image match first', () => {
    const parsed = { services: { postgres: { image: 'postgres:16', ports: ['5432:5432'] } } }
    expect(extractPostgresService(parsed)?.serviceName).toBe('postgres')
  })

  it('matches by image when the service key is not literally postgres', () => {
    const parsed = { services: { db: { image: 'postgres:16-alpine', ports: ['5440:5432'] } } }
    expect(extractPostgresService(parsed)?.serviceName).toBe('db')
  })
})

describe('parseRepoCompose', () => {
  it('parses the ephemeral fixture (docker-compose.yml)', () => {
    const repo = makeRepo({ 'docker-compose.yml': 'ephemeral.docker-compose.yml' })
    const { composeFile, postgres } = parseRepoCompose(repo)
    expect(composeFile).toBe('docker-compose.yml')
    expect(postgres).toEqual({
      serviceName: 'postgres',
      containerName: 'alpha-postgres',
      hostPort: null,
      isEphemeral: true,
      user: 'alpha',
      password: 'alpha',
      database: 'alpha',
    })
  })

  it('parses the interpolated-credentials fixture (compose.yaml)', () => {
    const repo = makeRepo({ 'compose.yaml': 'fixed-interpolated.compose.yaml' })
    const { postgres } = parseRepoCompose(repo)
    expect(postgres).toEqual({
      serviceName: 'db',
      containerName: 'beta-postgres',
      hostPort: 5440,
      isEphemeral: false,
      user: 'beta',
      password: 'beta',
      database: 'beta',
    })
  })

  it('parses the default-port fixture (compose.yml)', () => {
    const repo = makeRepo({ 'compose.yml': 'fixed-default-port.compose.yml' })
    const { postgres } = parseRepoCompose(repo)
    expect(postgres?.hostPort).toBe(5432)
    expect(postgres?.user).toBe('postgres')
  })

  it('parses a compose file nested under docker/', () => {
    const repo = makeRepo({ 'docker/docker-compose.yml': 'nested.docker-compose.yml' })
    const { composeFile, postgres } = parseRepoCompose(repo)
    expect(composeFile).toBe(join('docker', 'docker-compose.yml'))
    expect(postgres?.hostPort).toBe(5442)
  })

  it('parses an env-var-driven host port to its default', () => {
    const repo = makeRepo({ 'docker-compose.yml': 'fixed-env-port.docker-compose.yml' })
    const { postgres } = parseRepoCompose(repo)
    expect(postgres?.hostPort).toBe(5436)
  })

  it('returns null postgres info for a repo with no postgres service', () => {
    const repo = makeRepo({ 'docker-compose.yml': 'no-database.docker-compose.yml' })
    const { composeFile, postgres } = parseRepoCompose(repo)
    expect(composeFile).toBe('docker-compose.yml')
    expect(postgres).toBeNull()
  })

  it('returns nulls for a repo with no compose file at all', () => {
    const repo = mkdtempSync(join(tmpdir(), 'db-scan-compose-test-'))
    tmpDirs.push(repo)
    expect(parseRepoCompose(repo)).toEqual({ composeFile: null, postgres: null })
  })
})
