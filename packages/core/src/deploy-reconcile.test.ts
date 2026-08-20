/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { planReconcile, applyReconcile } from './deploy-reconcile.js'

const mockedExeca = vi.mocked(execa)

const NOW = Date.parse('2026-08-20T02:00:00Z')

function iso(secBeforeNow: number): string {
  return new Date(NOW - secBeforeNow * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

let dir: string

beforeEach(async () => {
  mockedExeca.mockReset()
  mockedExeca.mockResolvedValue({ stdout: 'a commit' } as any)
  dir = await mkdtemp(join(tmpdir(), 'emit-deploy-reconcile-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('planReconcile', () => {
  it('plans a reconcile for a genuinely orphaned deploy record (stale heartbeat)', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({
        status: 'deploying',
        sha: 'abc123',
        branch: 'main',
        startedAt: iso(600),
        progress: { step: 2, total: 3, pct: 66, label: 'Building + pushing images' },
        writer: { pid: 999999, host: 'other-host', heartbeatAt: iso(600) },
      }),
    )

    const plan = await planReconcile(dir, 'deploy', { now: NOW })

    expect(plan.action).toBe('reconcile')
    expect(plan.terminalRecord).toEqual({ status: 'orphaned', sha: 'abc123', branch: 'main', completedAt: iso(0) })
    expect(plan.historyLine).toMatchObject({
      status: 'orphaned',
      sha: 'abc123',
      branch: 'main',
      servicesBuilt: [],
      phases: {},
      message: 'a commit',
    })
    expect(typeof (plan.historyLine as any).durationSec).toBe('number')
  })

  it('plans a reconcile for a pre-283 record with no writer block, stale by age', async () => {
    await writeFile(
      join(dir, '.ci-status.json'),
      JSON.stringify({ status: 'running', sha: 'def456', branch: 'main', startedAt: iso(3600) }),
    )

    const plan = await planReconcile(dir, 'ci', { now: NOW })

    expect(plan.action).toBe('reconcile')
    expect(plan.historyLine).not.toHaveProperty('servicesBuilt')
    expect(plan.historyLine).not.toHaveProperty('phases')
  })

  it('does not touch a genuinely live record', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({
        status: 'deploying',
        sha: 'abc123',
        branch: 'main',
        startedAt: iso(10),
        writer: { pid: process.pid, host: hostname(), heartbeatAt: iso(5) },
      }),
    )

    const plan = await planReconcile(dir, 'deploy', { now: NOW })

    expect(plan.action).toBe('skip')
    expect(plan.reason).toContain('running')
  })

  it('skips a terminal (already idle) record', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({ status: 'deployed', sha: 'abc123', branch: 'main', completedAt: iso(0) }),
    )

    const plan = await planReconcile(dir, 'deploy', { now: NOW })

    expect(plan.action).toBe('skip')
    expect(plan.reason).toContain('idle')
  })

  it('handles a missing status file without crashing', async () => {
    const plan = await planReconcile(dir, 'deploy', { now: NOW })

    expect(plan.action).toBe('skip')
    expect(plan.reason).toContain('not found')
  })

  it('handles a malformed status file without crashing', async () => {
    await writeFile(join(dir, '.deploy-status.json'), '{ not json')

    const plan = await planReconcile(dir, 'deploy', { now: NOW })

    expect(plan.action).toBe('skip')
    expect(plan.reason).toContain('not valid JSON')
  })
})

describe('applyReconcile', () => {
  it('writes exactly one terminal record and appends exactly one history line', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({
        status: 'deploying',
        sha: 'abc123',
        branch: 'main',
        startedAt: iso(600),
        writer: { pid: 999999, host: 'other-host', heartbeatAt: iso(600) },
      }),
    )
    await appendFile(join(dir, '.deploy-history.jsonl'), JSON.stringify({ status: 'deployed', sha: 'zzz' }) + '\n')

    const plan = await planReconcile(dir, 'deploy', { now: NOW })
    await applyReconcile(plan)

    const status = JSON.parse(await readFile(join(dir, '.deploy-status.json'), 'utf8'))
    expect(status).toEqual({ status: 'orphaned', sha: 'abc123', branch: 'main', completedAt: iso(0) })

    const historyRaw = await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')
    const lines = historyRaw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).status).toBe('orphaned')
  })

  it('is a no-op when the plan says skip (dry-run safety net)', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({ status: 'deployed', sha: 'abc123', branch: 'main', completedAt: iso(0) }),
    )
    const before = await readFile(join(dir, '.deploy-status.json'), 'utf8')

    const plan = await planReconcile(dir, 'deploy', { now: NOW })
    await applyReconcile(plan)

    const after = await readFile(join(dir, '.deploy-status.json'), 'utf8')
    expect(after).toBe(before)
  })

  it('a plain planReconcile call never mutates the filesystem, regardless of outcome', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({
        status: 'deploying',
        sha: 'abc123',
        branch: 'main',
        startedAt: iso(600),
        writer: { pid: 999999, host: 'other-host', heartbeatAt: iso(600) },
      }),
    )
    const before = await readFile(join(dir, '.deploy-status.json'), 'utf8')

    await planReconcile(dir, 'deploy', { now: NOW })

    const after = await readFile(join(dir, '.deploy-status.json'), 'utf8')
    expect(after).toBe(before)
  })
})
