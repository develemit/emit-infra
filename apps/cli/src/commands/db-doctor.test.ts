import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RepoDbInfo } from '@emit-infra/core'
import { findOwnershipMismatches } from './db-doctor.js'

vi.mock('@emit-infra/core', async () => {
  const actual = await vi.importActual<typeof import('@emit-infra/core')>('@emit-infra/core')
  return { ...actual, verifyContainerOwnership: vi.fn() }
})

import { verifyContainerOwnership } from '@emit-infra/core'

function repo(name: string, containerName: string | null): RepoDbInfo {
  return {
    repo: name,
    repoPath: `/repos/${name}`,
    composeFile: 'docker-compose.yml',
    classification: 'fixed-port',
    postgres: containerName
      ? { serviceName: 'postgres', containerName, hostPort: 5432, isEphemeral: false, user: 'u', password: 'p', database: 'd' }
      : null,
  }
}

describe('findOwnershipMismatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips repos with no container name to check', async () => {
    const result = await findOwnershipMismatches([repo('a', null)])
    expect(result).toEqual([])
    expect(verifyContainerOwnership).not.toHaveBeenCalled()
  })

  it('reports only repos whose ownership check comes back mismatched', async () => {
    vi.mocked(verifyContainerOwnership).mockImplementation(async (_repoPath, containerName) =>
      containerName === 'b-postgres' ? 'mismatch' : 'owned',
    )

    const result = await findOwnershipMismatches([repo('a', 'a-postgres'), repo('b', 'b-postgres')])
    expect(result).toEqual(['b'])
  })

  it('treats not-running as fine, not a mismatch', async () => {
    vi.mocked(verifyContainerOwnership).mockResolvedValue('not-running')
    const result = await findOwnershipMismatches([repo('a', 'a-postgres')])
    expect(result).toEqual([])
  })
})
