import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalStatusRecord, formatPipelineLine } from './status.js'

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
