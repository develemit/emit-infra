import { describe, it, expect } from 'vitest'
import { evaluateGateStaleness } from './gate-staleness.js'

// Fleet shapes measured 2026-08-22 (see sprint 299) — the rule has to get
// all four right or it's exactly the kind of noisy-or-blind heuristic the
// sprint exists to avoid.
const NOW = Date.parse('2026-08-22T12:00:00Z')

describe('evaluateGateStaleness', () => {
  it('stays quiet for develemail: 51 unpushed commits behind a recent success', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 51,
      newestUnpushedCommitAt: '2026-08-01T09:00:00Z',
      ciRecord: {
        status: 'success',
        startedAt: '2026-08-20T10:00:00Z',
        completedAt: '2026-08-20T10:05:00Z',
      },
      now: NOW,
    })

    expect(result.warn).toBe(false)
    expect(result.reason).toBe('fresh-success')
  })

  it('warns for diner-decider: 98 unpushed commits behind a failed run', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 98,
      newestUnpushedCommitAt: '2026-08-01T09:00:00Z',
      ciRecord: {
        status: 'failure',
        startedAt: '2026-08-01T08:00:00Z',
        completedAt: '2026-08-01T08:05:00Z',
      },
      now: NOW,
    })

    expect(result.warn).toBe(true)
    expect(result.reason).toBe('failed')
  })

  it('warns when a successful run predates the newest unpushed commit', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 12,
      newestUnpushedCommitAt: '2026-08-15T00:00:00Z',
      ciRecord: {
        status: 'success',
        startedAt: '2026-08-01T00:00:00Z',
        completedAt: '2026-08-01T00:05:00Z',
      },
      now: NOW,
    })

    expect(result.warn).toBe(true)
    expect(result.reason).toBe('stale')
  })

  it('warns louder for emit-billing: 15 unpushed commits with no record at all', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 15,
      newestUnpushedCommitAt: '2026-08-13T00:00:00Z',
      ciRecord: null,
      now: NOW,
    })

    expect(result.warn).toBe(true)
    expect(result.reason).toBe('never-run')
    // Distinct from the merely-stale case — no record beats a stale one.
    expect(result.reason).not.toBe('stale')
  })

  it('stays quiet when there are no unpushed commits, regardless of record', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 0,
      newestUnpushedCommitAt: null,
      ciRecord: { status: 'failure', startedAt: '2026-01-01T00:00:00Z' },
      now: NOW,
    })

    expect(result.warn).toBe(false)
    expect(result.reason).toBe('no-unpushed')
  })

  it('warns when the last run is an orphaned in-flight record', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 5,
      newestUnpushedCommitAt: '2026-08-22T11:00:00Z',
      ciRecord: {
        status: 'running',
        startedAt: '2026-08-22T11:45:00Z',
        writer: { pid: 1234, host: 'other-host', heartbeatAt: '2026-08-22T11:50:00Z' },
      },
      now: NOW,
    })

    expect(result.warn).toBe(true)
    expect(result.reason).toBe('orphaned-run')
  })

  it('stays quiet while the gate is genuinely running right now', () => {
    const result = evaluateGateStaleness({
      unpushedCount: 5,
      newestUnpushedCommitAt: '2026-08-22T11:00:00Z',
      ciRecord: {
        status: 'running',
        startedAt: '2026-08-22T11:59:30Z',
        writer: { pid: 1234, host: 'other-host', heartbeatAt: '2026-08-22T11:59:50Z' },
      },
      now: NOW,
    })

    expect(result.warn).toBe(false)
    expect(result.reason).toBe('running')
  })
})
