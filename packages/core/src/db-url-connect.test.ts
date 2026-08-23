import { describe, it, expect, vi } from 'vitest'
import { waitUntilReady, fetchCurrentDatabase, assertDatabaseIdentity } from './db-url-connect.js'

function fakePool(query: (sql: string) => Promise<{ rows: unknown[] }>) {
  return { query }
}

describe('waitUntilReady', () => {
  it('returns as soon as a query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    await expect(waitUntilReady(fakePool(query), 1000, 5)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledWith('select 1')
  })

  it('retries until the timeout, then throws with the last error', async () => {
    // Fake timers instead of a real 30ms budget: at 30ms/10ms-interval scale,
    // a single scheduler stall under a loaded `nx run-many -t test` can eat
    // the whole budget in one turn, collapsing "several retries" into one and
    // failing the calls-count assertion below for reasons that have nothing
    // to do with the function under test. Faking the clock makes every tick
    // deterministic regardless of what else the machine is doing.
    vi.useFakeTimers()
    try {
      const query = vi.fn().mockRejectedValue(new Error('connection refused'))
      const result = expect(waitUntilReady(fakePool(query), 30, 10)).rejects.toThrow(
        /not ready within 30ms.*connection refused/s,
      )
      await vi.advanceTimersByTimeAsync(30)
      await result
      expect(query.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('succeeds after transient failures', async () => {
    let calls = 0
    const query = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) throw new Error('not ready yet')
      return { rows: [] }
    })
    await expect(waitUntilReady(fakePool(query), 1000, 5)).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })
})

describe('fetchCurrentDatabase', () => {
  it('returns the queried database name', async () => {
    const query = async () => ({ rows: [{ name: 'app_dev' }] })
    await expect(fetchCurrentDatabase(fakePool(query))).resolves.toBe('app_dev')
  })

  it('returns null when the query returns no rows', async () => {
    const query = async () => ({ rows: [] })
    await expect(fetchCurrentDatabase(fakePool(query))).resolves.toBeNull()
  })
})

describe('assertDatabaseIdentity', () => {
  it('does not throw when the found database matches expected', () => {
    expect(() => assertDatabaseIdentity('app_dev', 'app_dev')).not.toThrow()
  })

  it('throws naming both values on mismatch', () => {
    expect(() => assertDatabaseIdentity('other_db', 'app_dev')).toThrow(
      /connected to database "other_db", expected "app_dev"/,
    )
  })

  it('throws naming (none) when nothing was found', () => {
    expect(() => assertDatabaseIdentity(null, 'app_dev')).toThrow(
      /connected to database "\(none\)"/,
    )
  })
})
