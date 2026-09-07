import { describe, it, expect } from 'vitest'
import { createHttpCheckLog, isReservedTestDomain } from './http-check-log.js'

const HOUR = 60 * 60 * 1000

describe('createHttpCheckLog', () => {
  it('logs once for alternating TimeoutError/TypeError failures, not on every poll', () => {
    const log = createHttpCheckLog(() => 0)
    const timeoutErr = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    const typeErr = new TypeError('fetch failed')

    const first = log.onFailure('example.com', timeoutErr, 2, 0)
    const second = log.onFailure('example.com', typeErr, 2, 1_000)
    const third = log.onFailure('example.com', timeoutErr, 2, 2_000)

    expect(first).toContain('HTTP check failed for example.com')
    expect(second).toBeNull()
    expect(third).toBeNull()
  })

  it('re-logs a still-failing domain once per heartbeat interval with a suppressed count', () => {
    const log = createHttpCheckLog(() => 0)
    const err = new TypeError('fetch failed')

    log.onFailure('example.com', err, 2, 0) // first failure, logged
    log.onFailure('example.com', err, 2, 1_000) // suppressed (1)
    log.onFailure('example.com', err, 2, 2_000) // suppressed (2)
    const heartbeat = log.onFailure('example.com', err, 2, HOUR)

    expect(heartbeat).toBe('HTTP check still failing for example.com (2 occurrences in the last 1 hour)')
  })

  it('resets the suppressed count after a heartbeat fires', () => {
    const log = createHttpCheckLog(() => 0)
    const err = new TypeError('fetch failed')

    log.onFailure('example.com', err, 2, 0)
    log.onFailure('example.com', err, 2, HOUR) // first heartbeat: 0 suppressed
    log.onFailure('example.com', err, 2, HOUR + 1_000) // suppressed (1)
    const secondHeartbeat = log.onFailure('example.com', err, 2, 2 * HOUR)

    expect(secondHeartbeat).toBe('HTTP check still failing for example.com (1 occurrences in the last 1 hour)')
  })

  it('logs recovery once and resets state so a later failure logs again immediately', () => {
    const log = createHttpCheckLog(() => 0)
    const err = new TypeError('fetch failed')

    log.onFailure('example.com', err, 2, 0)
    expect(log.onRecovery('example.com')).toBe(true)
    expect(log.onRecovery('example.com')).toBe(false) // nothing to recover from twice

    const afterRecovery = log.onFailure('example.com', err, 2, 1_000)
    expect(afterRecovery).toContain('HTTP check failed for example.com')
  })

  it('does not let one failing domain suppress logging for another', () => {
    const log = createHttpCheckLog(() => 0)
    const err = new TypeError('fetch failed')

    const first = log.onFailure('a.example.com', err, 2, 0)
    const second = log.onFailure('b.example.com', err, 2, 0)

    expect(first).toContain('a.example.com')
    expect(second).toContain('b.example.com')
  })
})

describe('isReservedTestDomain', () => {
  it.each(['192.0.2.1', '198.51.100.42', '203.0.113.255'])(
    'flags %s as a reserved documentation-range IP',
    (domain) => {
      expect(isReservedTestDomain(domain)).toBe(true)
    },
  )

  it.each(['1.2.3.4', 'example.com', '192.0.3.1', '192.0.2.1.example.com'])(
    'does not flag %s',
    (domain) => {
      expect(isReservedTestDomain(domain)).toBe(false)
    },
  )
})
