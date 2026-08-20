import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTerraformOutput, readLocalStatusRecord, formatPipelineLine } from './status.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'

describe('getTerraformOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses the value for a normal terraform output', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ server_ip: { value: '1.2.3.4', type: 'string' } }),
    } as never)

    await expect(getTerraformOutput('server_ip')).resolves.toBe('1.2.3.4')
  })

  it('returns null when the state has no outputs (the "No outputs found" warning case)', async () => {
    // Regression: `terraform output -raw <key>` on a project with no outputs
    // writes a "Warning: No outputs found" banner to stdout with exit code 0,
    // which the old -raw-based implementation returned verbatim as the host.
    // `-json` on the same state returns a clean `{}`.
    vi.mocked(execa).mockResolvedValue({ stdout: '{}' } as never)

    await expect(getTerraformOutput('server_ip')).resolves.toBeNull()
  })

  it('returns null for malformed JSON instead of throwing', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'not json' } as never)

    await expect(getTerraformOutput('server_ip')).resolves.toBeNull()
  })

  it('returns null when the key is absent from the outputs object', async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ other_key: { value: 'x' } }),
    } as never)

    await expect(getTerraformOutput('server_ip')).resolves.toBeNull()
  })

  it('returns null when terraform itself fails (e.g. not installed, no state)', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('command not found'))

    await expect(getTerraformOutput('server_ip')).resolves.toBeNull()
  })
})

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
