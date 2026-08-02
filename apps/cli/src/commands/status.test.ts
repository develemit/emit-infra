import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTerraformOutput } from './status.js'

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
