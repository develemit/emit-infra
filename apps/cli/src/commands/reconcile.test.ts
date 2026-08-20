import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reconcileProject } from './reconcile.js'

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: 'a commit' })),
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emit-reconcile-cmd-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeStuckDeploy(): Promise<void> {
  await writeFile(
    join(dir, '.deploy-status.json'),
    JSON.stringify({
      status: 'deploying',
      sha: '6423d5d',
      branch: 'main',
      startedAt: '2020-01-01T00:00:00Z',
      progress: { step: 2, total: 3, pct: 66, label: 'Building + pushing images' },
    }),
  )
}

describe('reconcileProject', () => {
  it('reports both kinds and reconciles an orphaned deploy record without --write', async () => {
    await writeStuckDeploy()

    const plans = await reconcileProject(dir, false)

    const deployPlan = plans.find((p) => p.kind === 'deploy')!
    const ciPlan = plans.find((p) => p.kind === 'ci')!
    expect(deployPlan.action).toBe('reconcile')
    expect(ciPlan.action).toBe('skip')

    // dry-run: nothing written
    const status = JSON.parse(await readFile(join(dir, '.deploy-status.json'), 'utf8'))
    expect(status.status).toBe('deploying')
    await expect(readFile(join(dir, '.deploy-history.jsonl'), 'utf8')).rejects.toThrow()
  })

  it('applies the reconcile when write is true', async () => {
    await writeStuckDeploy()

    const plans = await reconcileProject(dir, true)
    expect(plans.find((p) => p.kind === 'deploy')!.action).toBe('reconcile')

    const status = JSON.parse(await readFile(join(dir, '.deploy-status.json'), 'utf8'))
    expect(status.status).toBe('orphaned')
    expect(status.writer).toBeUndefined()

    const historyRaw = await readFile(join(dir, '.deploy-history.jsonl'), 'utf8')
    expect(historyRaw.trim().split('\n')).toHaveLength(1)
  })

  it('leaves a live record untouched even with --write', async () => {
    await writeFile(
      join(dir, '.deploy-status.json'),
      JSON.stringify({
        status: 'deploying',
        sha: 'abc123',
        branch: 'main',
        startedAt: new Date().toISOString(),
        writer: { pid: process.pid, host: 'this-machine-does-not-matter', heartbeatAt: new Date().toISOString() },
      }),
    )
    const before = await readFile(join(dir, '.deploy-status.json'), 'utf8')

    const plans = await reconcileProject(dir, true)

    expect(plans.find((p) => p.kind === 'deploy')!.action).toBe('skip')
    const after = await readFile(join(dir, '.deploy-status.json'), 'utf8')
    expect(after).toBe(before)
  })

  it('handles missing/malformed files for both kinds without throwing', async () => {
    await writeFile(join(dir, '.ci-status.json'), 'not json')

    const plans = await reconcileProject(dir, true)

    expect(plans.find((p) => p.kind === 'deploy')!.reason).toContain('not found')
    expect(plans.find((p) => p.kind === 'ci')!.reason).toContain('not valid JSON')
  })
})
