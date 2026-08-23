import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateGateStaleness } from '@emit-infra/core'
import { readLocalStatusRecord, formatPipelineLine, formatGateStalenessLine, hasLocalPipelineRecord } from './status.js'

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

  // Sprint 305: launch.mode/launch.marker (sprint 290) surfaced on the Deploy
  // line. `launch` is passed explicitly rather than read off the record so
  // these cases also prove the CI call site's omission (never passed) is a
  // real behavioral choice, not just an artifact of CI records lacking it.
  it('prints each launch mode on the Deploy line', () => {
    const record = { status: 'deployed', completedAt: '2026-08-20T00:00:00Z' }

    expect(formatPipelineLine('Deploy', record, { mode: 'interactive', marker: '' })).toContain('interactive')
    expect(formatPipelineLine('Deploy', record, { mode: 'detached', marker: '' })).toContain('detached')
    expect(formatPipelineLine('Deploy', record, { mode: 'unattended-override', marker: '' })).toContain('unattended-override')
  })

  it('includes the marker when it adds information, omits it when empty', () => {
    const record = { status: 'deployed', completedAt: '2026-08-20T00:00:00Z' }

    const withMarker = formatPipelineLine('Deploy', record, { mode: 'unattended-override', marker: 'CI' })
    expect(withMarker).toContain('via CI')

    const withoutMarker = formatPipelineLine('Deploy', record, { mode: 'interactive', marker: '' })
    expect(withoutMarker).not.toContain('via')
  })

  it('omits launch info for a record with no launch block (pre-290 record)', () => {
    const line = formatPipelineLine('Deploy', { status: 'deployed', completedAt: '2026-08-20T00:00:00Z' })

    expect(line).not.toContain('interactive')
    expect(line).not.toContain('detached')
    expect(line).not.toContain('unattended-override')
  })

  it('never prints a launch field on the CI line', () => {
    const line = formatPipelineLine('CI', { status: 'success', completedAt: '2026-08-20T00:00:00Z' })

    expect(line).not.toContain('interactive')
    expect(line).not.toContain('detached')
    expect(line).not.toContain('unattended-override')
  })
})

describe('hasLocalPipelineRecord', () => {
  it('is false when both records are absent — the section is suppressed', () => {
    expect(hasLocalPipelineRecord(null, null)).toBe(false)
  })

  it('is true when only one record exists — the section still prints in full', () => {
    expect(hasLocalPipelineRecord({ status: 'success' }, null)).toBe(true)
    expect(hasLocalPipelineRecord(null, { status: 'deployed' })).toBe(true)
  })

  it('is true when both records exist', () => {
    expect(hasLocalPipelineRecord({ status: 'success' }, { status: 'deployed' })).toBe(true)
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
