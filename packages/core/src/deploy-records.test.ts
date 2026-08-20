/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { deployRecordInit, deployRecordDone } from './deploy-records.js'

const mockedExeca = vi.mocked(execa)

function mockGit(sha: string, branch: string, message: string) {
  mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve({ stdout: sha } as any)
    if (args[0] === 'rev-parse') return Promise.resolve({ stdout: branch } as any)
    if (args[0] === 'log') return Promise.resolve({ stdout: message } as any)
    return Promise.resolve({ stdout: '' } as any)
  }) as any)
}

let dir: string

beforeEach(async () => {
  mockedExeca.mockReset()
  dir = await mkdtemp(join(tmpdir(), 'emit-deploy-records-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('deployRecordInit', () => {
  it('writes a deploying status file with sha/branch/startedAt/progress', async () => {
    mockGit('abc123', 'main', 'a commit')

    const ctx = await deployRecordInit(dir)

    expect(ctx.sha).toBe('abc123')
    expect(ctx.branch).toBe('main')
    expect(ctx.message).toBe('a commit')

    const raw = await readFile(join(dir, '.deploy-status.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({
      status: 'deploying',
      sha: 'abc123',
      branch: 'main',
      startedAt: ctx.startedAt,
      progress: { step: 0, total: 1, pct: 0, label: 'starting' },
      writer: { pid: process.pid, host: parsed.writer.host, heartbeatAt: ctx.startedAt },
    })
  })

  it('writes a writer block with this process\'s pid/host on init', async () => {
    mockGit('abc123', 'main', 'a commit')

    await deployRecordInit(dir)

    const parsed = JSON.parse(await readFile(join(dir, '.deploy-status.json'), 'utf8'))
    expect(parsed.writer.pid).toBe(process.pid)
    expect(typeof parsed.writer.host).toBe('string')
    expect(parsed.writer.host.length).toBeGreaterThan(0)
    expect(typeof parsed.writer.heartbeatAt).toBe('string')
  })

  it('falls back to empty strings when git commands fail (non-git cwd)', async () => {
    mockedExeca.mockRejectedValue(new Error('not a git repo'))

    const ctx = await deployRecordInit(dir)

    expect(ctx.sha).toBe('')
    expect(ctx.branch).toBe('')
    expect(ctx.message).toBe('')
  })
})

describe('deployRecordDone', () => {
  it('writes a final status file and a history line shape-identical to the hook (ci-utils.sh deploy_done)', async () => {
    mockGit('abc123', 'main', 'a commit')
    const ctx = await deployRecordInit(dir)

    await deployRecordDone(dir, ctx, 'deployed', { deploy: 12 })

    const statusRaw = await readFile(join(dir, '.deploy-status.json'), 'utf8')
    const status = JSON.parse(statusRaw)
    expect(Object.keys(status)).toEqual(['status', 'sha', 'branch', 'completedAt'])
    expect(status.status).toBe('deployed')
    expect(status.sha).toBe('abc123')
    expect(status.branch).toBe('main')
    expect(status.writer).toBeUndefined()

    const historyRaw = await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')
    const lines = historyRaw.trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)

    // Same key set/order ci-utils.sh's deploy_done printf produces, so the
    // dashboard/API (history.ts) and resolve_last_deployed_sha can't tell
    // a CLI-written record apart from a hook-written one.
    expect(Object.keys(entry)).toEqual([
      'status', 'sha', 'branch', 'startedAt', 'completedAt',
      'durationSec', 'servicesBuilt', 'phases', 'message',
    ])
    expect(entry.status).toBe('deployed')
    expect(entry.sha).toBe('abc123')
    expect(entry.branch).toBe('main')
    expect(entry.servicesBuilt).toEqual([])
    expect(entry.phases).toEqual({ deploy: 12 })
    expect(entry.message).toBe('a commit')
    expect(typeof entry.durationSec).toBe('number')
  })

  it('records a failed deploy without throwing (failure path)', async () => {
    mockGit('deadbeef', 'main', 'oops')
    const ctx = await deployRecordInit(dir)

    await deployRecordDone(dir, ctx, 'failed', { deploy: 3 })

    const status = JSON.parse(await readFile(join(dir, '.deploy-status.json'), 'utf8'))
    expect(status.status).toBe('failed')

    const entry = JSON.parse((await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')).trim())
    expect(entry.status).toBe('failed')
    expect(entry.phases).toEqual({ deploy: 3 })
  })

  it('appends to existing history rather than overwriting', async () => {
    mockGit('sha1', 'main', 'first')
    const ctx1 = await deployRecordInit(dir)
    await deployRecordDone(dir, ctx1, 'deployed')

    mockGit('sha2', 'main', 'second')
    const ctx2 = await deployRecordInit(dir)
    await deployRecordDone(dir, ctx2, 'deployed')

    const lines = (await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).sha).toBe('sha1')
    expect(JSON.parse(lines[1]!).sha).toBe('sha2')
  })

  it('truncates history to the newest 500 lines once it exceeds 1000 (parity with _emit_truncate_history)', async () => {
    mockGit('sha', 'main', 'msg')
    const ctx = await deployRecordInit(dir)
    const lines: string[] = []
    for (let i = 0; i < 1001; i++) {
      lines.push(JSON.stringify({ status: 'deployed', sha: `s${i}`, branch: 'main' }))
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, '.deploy-history.jsonl'), lines.join('\n') + '\n')

    await deployRecordDone(dir, ctx, 'deployed')

    const finalLines = (await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')).trim().split('\n')
    expect(finalLines).toHaveLength(500)
    expect(JSON.parse(finalLines[0]!).sha).toBe('s502')
    expect(JSON.parse(finalLines.at(-1)!).sha).toBe('sha')
  })

  it('defaults phases to an empty object when none provided', async () => {
    mockGit('sha', 'main', 'msg')
    const ctx = await deployRecordInit(dir)

    await deployRecordDone(dir, ctx, 'deployed')

    const entry = JSON.parse((await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')).trim())
    expect(entry.phases).toEqual({})
  })
})
