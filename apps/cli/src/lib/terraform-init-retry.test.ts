import { describe, it, expect, vi } from 'vitest'
import { isTransientR2AuthError, terraformInitWithR2Retry } from './terraform-init-retry.js'

function noopSleep(): Promise<void> {
  return Promise.resolve()
}

describe('isTransientR2AuthError', () => {
  it('matches a 401 in the error message', () => {
    expect(isTransientR2AuthError(new Error('StatusCode: 401'))).toBe(true)
  })

  it('matches "Unauthorized" case-insensitively', () => {
    expect(isTransientR2AuthError(new Error('403: unauthorized access'))).toBe(true)
  })

  it('does not match an unrelated error', () => {
    expect(isTransientR2AuthError(new Error('terraform exited with code 1'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isTransientR2AuthError('401')).toBe(false)
  })
})

describe('terraformInitWithR2Retry', () => {
  it('succeeds without retrying when the first attempt succeeds', async () => {
    const runInit = vi.fn().mockResolvedValue(undefined)

    await terraformInitWithR2Retry(runInit, { sleep: noopSleep })

    expect(runInit).toHaveBeenCalledTimes(1)
  })

  it('retries a transient 401 and succeeds once the token propagates', async () => {
    const runInit = vi
      .fn()
      .mockRejectedValueOnce(new Error('StatusCode: 401 Unauthorized'))
      .mockRejectedValueOnce(new Error('StatusCode: 401 Unauthorized'))
      .mockResolvedValueOnce(undefined)

    await terraformInitWithR2Retry(runInit, { sleep: noopSleep, initialDelayMs: 1 })

    expect(runInit).toHaveBeenCalledTimes(3)
  })

  it('gives up after the bounded budget and names the minted-just-now case', async () => {
    const runInit = vi.fn().mockRejectedValue(new Error('StatusCode: 401 Unauthorized'))

    await expect(
      terraformInitWithR2Retry(runInit, { sleep: noopSleep, maxAttempts: 3, initialDelayMs: 1 }),
    ).rejects.toThrow(/minted moments ago/)
    expect(runInit).toHaveBeenCalledTimes(3)
  })

  it('passes through a genuine (non-auth) failure without the propagation message', async () => {
    const runInit = vi.fn().mockRejectedValue(new Error('terraform exited with code 1'))

    await expect(
      terraformInitWithR2Retry(runInit, { sleep: noopSleep, maxAttempts: 2, initialDelayMs: 1 }),
    ).rejects.toThrow('terraform exited with code 1')
  })
})
