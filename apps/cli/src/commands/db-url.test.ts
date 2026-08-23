import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDbUrl } from './db-url.js'

vi.mock('@emit-infra/core', () => ({
  parseRepoComposeService: vi.fn(),
  resolveHostPort: vi.fn(),
  buildDatabaseUrl: vi.fn(),
  createPool: vi.fn(),
  waitUntilReady: vi.fn(),
  fetchCurrentDatabase: vi.fn(),
  assertDatabaseIdentity: vi.fn(),
}))

import {
  parseRepoComposeService,
  resolveHostPort,
  buildDatabaseUrl,
  createPool,
  waitUntilReady,
  fetchCurrentDatabase,
  assertDatabaseIdentity,
} from '@emit-infra/core'

const POSTGRES = {
  serviceName: 'postgres',
  containerName: 'c',
  hostPort: null,
  isEphemeral: true,
  user: 'app',
  password: 'secret',
  database: 'app_dev',
}

describe('resolveDbUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves and returns the URL without connecting, by default', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker-compose.yml',
      postgres: POSTGRES,
    })
    vi.mocked(resolveHostPort).mockResolvedValue(54321)
    vi.mocked(buildDatabaseUrl).mockReturnValue('postgres://app:secret@localhost:54321/app_dev')

    const url = await resolveDbUrl('/repo', { service: 'postgres' })

    expect(url).toBe('postgres://app:secret@localhost:54321/app_dev')
    expect(createPool).not.toHaveBeenCalled()
  })

  it('runs "docker compose port" from the compose file\'s own directory, not the repo root', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker/docker-compose.yml',
      postgres: POSTGRES,
    })
    vi.mocked(resolveHostPort).mockResolvedValue(54321)
    vi.mocked(buildDatabaseUrl).mockReturnValue('postgres://app:secret@localhost:54321/app_dev')

    await resolveDbUrl('/repo', { service: 'postgres' })

    expect(resolveHostPort).toHaveBeenCalledWith('/repo/docker', 'postgres')
  })

  it('throws when no compose file exists in the repo', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({ composeFile: null, postgres: null })

    await expect(resolveDbUrl('/repo', { service: 'postgres' })).rejects.toThrow(
      /No docker-compose file found/,
    )
  })

  it('throws naming the service when it is absent from the compose file', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker-compose.yml',
      postgres: null,
    })

    await expect(resolveDbUrl('/repo', { service: 'db' })).rejects.toThrow(/No "db" service found/)
  })

  it('propagates the not-running error from resolveHostPort without printing a URL', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker-compose.yml',
      postgres: POSTGRES,
    })
    vi.mocked(resolveHostPort).mockRejectedValue(new Error('container not running'))

    await expect(resolveDbUrl('/repo', { service: 'postgres' })).rejects.toThrow(
      'container not running',
    )
    expect(buildDatabaseUrl).not.toHaveBeenCalled()
  })

  it('with --assert-identity: waits for readiness, checks identity, and closes the pool', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker-compose.yml',
      postgres: POSTGRES,
    })
    vi.mocked(resolveHostPort).mockResolvedValue(54321)
    vi.mocked(buildDatabaseUrl).mockReturnValue('postgres://app:secret@localhost:54321/app_dev')
    const pool = { end: vi.fn().mockResolvedValue(undefined) }
    vi.mocked(createPool).mockResolvedValue(pool as never)
    vi.mocked(fetchCurrentDatabase).mockResolvedValue('app_dev')

    const url = await resolveDbUrl('/repo', { service: 'postgres', assertIdentity: true })

    expect(url).toBe('postgres://app:secret@localhost:54321/app_dev')
    expect(waitUntilReady).toHaveBeenCalledWith(pool)
    expect(assertDatabaseIdentity).toHaveBeenCalledWith('app_dev', 'app_dev')
    expect(pool.end).toHaveBeenCalled()
  })

  it('with --assert-identity: closes the pool even when the identity check throws', async () => {
    vi.mocked(parseRepoComposeService).mockReturnValue({
      composeFile: 'docker-compose.yml',
      postgres: POSTGRES,
    })
    vi.mocked(resolveHostPort).mockResolvedValue(54321)
    vi.mocked(buildDatabaseUrl).mockReturnValue('postgres://app:secret@localhost:54321/app_dev')
    const pool = { end: vi.fn().mockResolvedValue(undefined) }
    vi.mocked(createPool).mockResolvedValue(pool as never)
    vi.mocked(fetchCurrentDatabase).mockResolvedValue('wrong_db')
    vi.mocked(assertDatabaseIdentity).mockImplementation(() => {
      throw new Error('connected to database "wrong_db", expected "app_dev"')
    })

    await expect(
      resolveDbUrl('/repo', { service: 'postgres', assertIdentity: true }),
    ).rejects.toThrow(/wrong_db.*app_dev/)
    expect(pool.end).toHaveBeenCalled()
  })
})
