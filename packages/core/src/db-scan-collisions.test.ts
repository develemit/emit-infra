import { describe, it, expect } from 'vitest'
import { detectPortCollisions, detectCredentialCollisions, detectDefaultPortWarnings } from './db-scan-collisions.js'
import type { RepoDbInfo } from './db-scan-fleet.js'

function repo(overrides: Partial<RepoDbInfo> & { repo: string }): RepoDbInfo {
  return {
    repoPath: `/repos/${overrides.repo}`,
    composeFile: 'docker-compose.yml',
    postgres: null,
    classification: 'no-database',
    ...overrides,
  }
}

function fixedPort(repoName: string, hostPort: number, user: string, password: string): RepoDbInfo {
  return repo({
    repo: repoName,
    classification: 'fixed-port',
    postgres: { serviceName: 'postgres', containerName: null, hostPort, isEphemeral: false, user, password, database: repoName },
  })
}

describe('detectPortCollisions', () => {
  it('reports no collisions when every fixed port is unique', () => {
    const repos = [fixedPort('a', 5433, 'a', 'a'), fixedPort('b', 5434, 'b', 'b')]
    expect(detectPortCollisions(repos)).toEqual([])
  })

  it('reports two repos sharing a fixed host port', () => {
    const repos = [fixedPort('a', 5433, 'a', 'a'), fixedPort('b', 5433, 'b', 'b')]
    expect(detectPortCollisions(repos)).toEqual([{ port: 5433, repos: ['a', 'b'] }])
  })

  it('ignores ephemeral repos entirely, even if their host port happened to resolve the same', () => {
    const repos = [
      repo({ repo: 'a', classification: 'ephemeral', postgres: { serviceName: 'postgres', containerName: null, hostPort: null, isEphemeral: true, user: 'a', password: 'a', database: 'a' } }),
      fixedPort('b', 5433, 'b', 'b'),
    ]
    expect(detectPortCollisions(repos)).toEqual([])
  })

  it('sorts multiple collisions by port ascending', () => {
    const repos = [
      fixedPort('a', 5435, 'a', 'a'), fixedPort('b', 5435, 'b', 'b'),
      fixedPort('c', 5433, 'c', 'c'), fixedPort('d', 5433, 'd', 'd'),
    ]
    expect(detectPortCollisions(repos).map((c) => c.port)).toEqual([5433, 5435])
  })
})

describe('detectCredentialCollisions', () => {
  it('reports no collisions when credentials differ', () => {
    const repos = [fixedPort('a', 5433, 'a', 'a'), fixedPort('b', 5434, 'b', 'b')]
    expect(detectCredentialCollisions(repos)).toEqual([])
  })

  it('reports two repos sharing a user/password pair even on different ports', () => {
    const repos = [fixedPort('a', 5432, 'postgres', 'postgres'), fixedPort('b', 5433, 'postgres', 'postgres')]
    expect(detectCredentialCollisions(repos)).toEqual([{ user: 'postgres', password: 'postgres', repos: ['a', 'b'] }])
  })

  it('does not treat a matching user with a different password as a collision', () => {
    const repos = [fixedPort('a', 5432, 'postgres', 'postgres'), fixedPort('b', 5433, 'postgres', 'other')]
    expect(detectCredentialCollisions(repos)).toEqual([])
  })
})

describe('detectDefaultPortWarnings', () => {
  it('flags a repo on the default postgres port 5432', () => {
    const repos = [fixedPort('a', 5432, 'postgres', 'postgres'), fixedPort('b', 5433, 'b', 'b')]
    expect(detectDefaultPortWarnings(repos)).toEqual(['a'])
  })

  it('does not flag an ephemeral repo even if hostPort were somehow 5432', () => {
    const repos = [repo({ repo: 'a', classification: 'ephemeral', postgres: { serviceName: 'postgres', containerName: null, hostPort: null, isEphemeral: true, user: 'a', password: 'a', database: 'a' } })]
    expect(detectDefaultPortWarnings(repos)).toEqual([])
  })
})
