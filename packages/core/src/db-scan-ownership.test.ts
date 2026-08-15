import { describe, it, expect } from 'vitest'
import { verifyContainerOwnership } from './db-scan-ownership.js'

describe('verifyContainerOwnership', () => {
  it('returns not-running when there is no container name to check', async () => {
    const inspect = async () => '/repos/whatever'
    await expect(verifyContainerOwnership('/repos/my-repo', null, inspect)).resolves.toBe('not-running')
  })

  it('returns not-running when inspect finds no such container', async () => {
    const inspect = async () => null
    await expect(verifyContainerOwnership('/repos/my-repo', 'my-repo-postgres', inspect)).resolves.toBe('not-running')
  })

  it('returns owned when the working_dir label matches the repo path', async () => {
    const inspect = async () => '/repos/my-repo'
    await expect(verifyContainerOwnership('/repos/my-repo', 'my-repo-postgres', inspect)).resolves.toBe('owned')
  })

  it('returns mismatch when the working_dir label points elsewhere', async () => {
    // The math-problemizer / study-haul case: a container name that reads
    // like it belongs to a different project than the one that actually owns it.
    const inspect = async () => '/repos/some-other-repo'
    await expect(verifyContainerOwnership('/repos/my-repo', 'study-haul-postgres', inspect)).resolves.toBe('mismatch')
  })
})
