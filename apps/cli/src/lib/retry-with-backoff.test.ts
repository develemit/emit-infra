import { describe, it, expect, vi } from 'vitest'
import { retryWithBackoff } from './retry-with-backoff.js'

function noopSleep(): Promise<void> {
  return Promise.resolve()
}

describe('retryWithBackoff', () => {
  it('returns the result on first success without sleeping', async () => {
    const sleep = vi.fn(noopSleep)
    const fn = vi.fn().mockResolvedValue('ok')

    const result = await retryWithBackoff(fn, { sleep })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries after a failure and succeeds within the attempt budget', async () => {
    const sleep = vi.fn(noopSleep)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok')

    const result = await retryWithBackoff(fn, { maxAttempts: 5, sleep })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially between attempts', async () => {
    const sleep = vi.fn(noopSleep)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok')

    await retryWithBackoff(fn, { initialDelayMs: 100, factor: 3, sleep })

    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 300)
  })

  it('throws the last error once maxAttempts is exhausted', async () => {
    const sleep = vi.fn(noopSleep)
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'))

    await expect(retryWithBackoff(fn, { maxAttempts: 3, sleep })).rejects.toThrow(
      'persistent failure',
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up immediately when isRetryable rejects the error, without sleeping', async () => {
    const sleep = vi.fn(noopSleep)
    const fn = vi.fn().mockRejectedValue(new Error('not retryable'))

    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, sleep, isRetryable: () => false }),
    ).rejects.toThrow('not retryable')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
