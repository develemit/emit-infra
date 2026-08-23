import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateGateStaleness } from '@emit-infra/core'
import { readLocalStatusRecord, formatPipelineLine, formatGateStalenessLine } from './status.js'

describe('readLocalStatusRecord', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emit-status-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns null when the file does not exist', async () => {
    await expect(readLocalStatusRecord(dir, '.deploy-status.json')).resolves.toBeNull()
  })

  it('returns null instead of throwing on malformed JSON', async () => {
    await writeFile(join(dir, '.deploy-status.json'), 'not json')

    await expect(readLocalStatusRecord(dir, '.deploy-status.json')).resolves.toBeNull()
  })

  it('parses a well-formed status record', async () => {
    const record = { status: 'deploying', sha: 'abc123', branch: 'main' }
    await writeFile(join(dir, '.deploy-status.json'), JSON.stringify(record))

    await expect(readLocalStatusRecord(dir, '.deploy-status.json')).resolves.toEqual(record)
  })
})

describe('formatPipelineLine', () => {
  it('reports no local record when the file was never written', () => {
    expect(formatPipelineLine('CI', null)).toContain('no local record')
  })

  it('reports idle for a terminal record', () => {
    expect(formatPipelineLine('CI', { status: 'success' })).toContain('idle')
  })

  it('includes the progress label and pct for an in-flight record', () => {
    const line = formatPipelineLine('Deploy', {
      status: 'deploying',
      progress: { step: 1, total: 3, pct: 33, label: 'building' },
    })

    expect(line).toContain('building')
    expect(line).toContain('33%')
  })
})

describe('formatGateStalenessLine', () => {
  it('produces no output when there are no unpushed commits', () => {
    const verdict = evaluateGateStaleness({ unpushedCount: 0, newestUnpushedCommitAt: null, ciRecord: null })

    expect(formatGateStalenessLine(verdict)).toBeNull()
  })

  it('warns and names the never-run case when there is no ci-status record', () => {
    const verdict = evaluateGateStaleness({
      unpushedCount: 15,
      newestUnpushedCommitAt: '2026-08-13T00:00:00Z',
      ciRecord: null,
    })
    const line = formatGateStalenessLine(verdict)

    expect(line).toContain('never run')
    expect(line).toContain('cached origin/main')
  })

  it('stays quiet for a stale-commit-backlog with a recent success', () => {
    const verdict = evaluateGateStaleness({
      unpushedCount: 51,
      newestUnpushedCommitAt: '2026-08-01T00:00:00Z',
      ciRecord: { status: 'success', startedAt: '2026-08-20T00:00:00Z', completedAt: '2026-08-20T00:05:00Z' },
    })
    const line = formatGateStalenessLine(verdict)

    expect(line).not.toBeNull()
    expect(line).toContain('successfully')
  })
})
