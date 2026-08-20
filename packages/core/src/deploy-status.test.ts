import { describe, it, expect } from 'vitest'
import {
  classifyRunState,
  HEARTBEAT_INTERVAL_SEC,
  ORPHAN_HEARTBEAT_THRESHOLD_SEC,
  UNKNOWN_RECORD_ORPHAN_AGE_SEC,
  type DeployStatusRecord,
  type DeployWriterInfo,
} from './deploy-status.js'

const NOW = Date.parse('2026-08-20T00:10:00Z')
const HOST = 'studio'

function iso(secBeforeNow: number): string {
  return new Date(NOW - secBeforeNow * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function inFlight(overrides: Partial<DeployStatusRecord> = {}): DeployStatusRecord {
  return {
    status: 'deploying',
    sha: 'abc123',
    branch: 'main',
    startedAt: iso(60),
    progress: { step: 1, total: 3, pct: 33, label: 'building' },
    ...overrides,
  }
}

describe('classifyRunState', () => {
  it('reports running for a live same-host pid', () => {
    const record = inFlight({ writer: { pid: 4242, host: HOST, heartbeatAt: iso(200) } })

    const result = classifyRunState(record, { now: NOW, currentHost: HOST, isPidAlive: () => true })

    expect(result.state).toBe('running')
    expect(result.sameHost).toBe(true)
    expect(result.pidAlive).toBe(true)
  })

  it('reports orphaned for a dead same-host pid, even with a fresh heartbeat', () => {
    const record = inFlight({ writer: { pid: 4242, host: HOST, heartbeatAt: iso(5) } })

    const result = classifyRunState(record, { now: NOW, currentHost: HOST, isPidAlive: () => false })

    expect(result.state).toBe('orphaned')
    expect(result.sameHost).toBe(true)
    expect(result.pidAlive).toBe(false)
  })

  it('reports orphaned for a stale heartbeat when no same-host pid check applies', () => {
    // Same host but pid isn't a usable number here (e.g. a partially-written
    // record) — a live pid is the stronger, definitive signal per the
    // context notes, so staleness only decides the outcome when that signal
    // isn't available.
    const record = inFlight({
      writer: { host: HOST, heartbeatAt: iso(ORPHAN_HEARTBEAT_THRESHOLD_SEC + 1) } as DeployWriterInfo,
    })

    const result = classifyRunState(record, { now: NOW, currentHost: HOST, isPidAlive: () => true })

    expect(result.state).toBe('orphaned')
    expect(result.heartbeatAgeSec).toBe(ORPHAN_HEARTBEAT_THRESHOLD_SEC + 1)
  })

  it('reports running for a fresh heartbeat', () => {
    const record = inFlight({
      writer: { pid: 4242, host: HOST, heartbeatAt: iso(HEARTBEAT_INTERVAL_SEC) },
    })

    const result = classifyRunState(record, { now: NOW, currentHost: 'other-host', isPidAlive: () => true })

    expect(result.state).toBe('running')
    expect(result.sameHost).toBe(false)
  })

  it('classifies a cross-host record by heartbeat alone, ignoring pid liveness', () => {
    const record = inFlight({ writer: { pid: 4242, host: 'laptop', heartbeatAt: iso(10) } })

    const result = classifyRunState(record, {
      now: NOW,
      currentHost: HOST,
      isPidAlive: () => {
        throw new Error('must not be called for a cross-host record')
      },
    })

    expect(result.state).toBe('running')
    expect(result.sameHost).toBe(false)
    expect(result.pidAlive).toBeNull()
  })

  it('cross-host record with a stale heartbeat is orphaned', () => {
    const record = inFlight({
      writer: { pid: 4242, host: 'laptop', heartbeatAt: iso(ORPHAN_HEARTBEAT_THRESHOLD_SEC * 2) },
    })

    const result = classifyRunState(record, { now: NOW, currentHost: HOST })

    expect(result.state).toBe('orphaned')
    expect(result.sameHost).toBe(false)
  })

  it('a missing writer block (pre-283 record) started recently is unknown, not running', () => {
    const record = inFlight({ startedAt: iso(60) })
    delete record.writer

    const result = classifyRunState(record, { now: NOW, currentHost: HOST })

    expect(result.state).toBe('unknown')
    expect(result.pidAlive).toBeNull()
    expect(result.sameHost).toBeNull()
  })

  it('a missing writer block (pre-283 record) started long ago is orphaned', () => {
    const record = inFlight({ startedAt: iso(UNKNOWN_RECORD_ORPHAN_AGE_SEC + 1) })
    delete record.writer

    const result = classifyRunState(record, { now: NOW, currentHost: HOST })

    expect(result.state).toBe('orphaned')
  })

  it('a terminal record is idle regardless of writer contents', () => {
    const record: DeployStatusRecord = {
      status: 'deployed',
      sha: 'abc123',
      branch: 'main',
      completedAt: iso(0),
    }

    const result = classifyRunState(record, { now: NOW, currentHost: HOST })

    expect(result.state).toBe('idle')
  })

  it('never crashes on a malformed or partial record', () => {
    expect(classifyRunState(null).state).toBe('unknown')
    expect(classifyRunState(undefined).state).toBe('unknown')
    expect(classifyRunState({}).state).toBe('idle')
    expect(classifyRunState({ status: 'deploying' }).state).toBe('unknown')
    expect(
      classifyRunState(
        { status: 'deploying', writer: { pid: 1, host: 'other-host', heartbeatAt: 'not-a-date' } },
        { currentHost: HOST },
      ).state,
    ).toBe('unknown')
  })
})
