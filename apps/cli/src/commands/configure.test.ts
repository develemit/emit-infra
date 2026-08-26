import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseInventoryHosts, registerConfigure, resolveInventoryPath } from './configure.js'

vi.mock('@emit-infra/core', async () => {
  const actual = await vi.importActual<typeof import('@emit-infra/core')>('@emit-infra/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    runAnsible: vi.fn(),
    getTerraformOutput: vi.fn(),
  }
})

import { getTerraformOutput, loadConfig, runAnsible } from '@emit-infra/core'

const baseConfig = {
  name: 'martialops',
  domain: 'martialops.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/martialops' },
}

describe('parseInventoryHosts', () => {
  it('extracts a single host from a simple inventory', () => {
    const content = '[martialops]\n178.105.239.144 ansible_user=root\n'
    expect(parseInventoryHosts(content)).toEqual(['178.105.239.144'])
  })

  it('skips comments and blank lines', () => {
    const content = [
      '# fleet inventory',
      '',
      '[martialops]',
      '   ',
      '178.105.239.144 ansible_user=root ansible_ssh_private_key_file=~/.ssh/emit-deploy',
      '# trailing comment',
    ].join('\n')
    expect(parseInventoryHosts(content)).toEqual(['178.105.239.144'])
  })

  it('ignores everything after the host token, including quoted ssh args', () => {
    const content = "178.105.239.144 ansible_user=root ansible_ssh_common_args='-o StrictHostKeyChecking=accept-new'\n"
    expect(parseInventoryHosts(content)).toEqual(['178.105.239.144'])
  })

  it('collapses multiple groups pointing at the same host to one entry', () => {
    const content = '[web]\n178.105.239.144\n\n[db]\n178.105.239.144\n'
    expect(parseInventoryHosts(content)).toEqual(['178.105.239.144'])
  })

  it('reports every distinct host across groups', () => {
    const content = '[web]\n178.105.239.144\n\n[db]\n167.233.43.96\n'
    expect(parseInventoryHosts(content).sort()).toEqual(['167.233.43.96', '178.105.239.144'])
  })

  it('returns an empty list for a file with no hosts', () => {
    expect(parseInventoryHosts('# empty\n\n[group]\n')).toEqual([])
  })
})

describe('resolveInventoryPath — existing inventory validation', () => {
  let dir: string
  let originalCwd: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'configure-inventory-')))
    originalCwd = process.cwd()
    process.chdir(dir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a matching inventory unchanged', async () => {
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[martialops]\n178.105.239.144 ansible_user=root\n')
    const config = { ...baseConfig, serverIp: '178.105.239.144' }

    const result = await resolveInventoryPath('martialops', config)

    expect(result).toBe(join(dir, 'ansible-inventory.ini'))
  })

  it('throws on the martialops scenario: config says one IP, inventory holds another live project\'s IP', async () => {
    // Regression for the 2026-08-26 martialops rebuild: its inventory still held
    // 178.104.195.59, since reassigned by Hetzner to tastease (a live project).
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[martialops]\n178.104.195.59 ansible_user=root\n')
    const config = { ...baseConfig, serverIp: '178.105.239.144' }

    await expect(resolveInventoryPath('martialops', config)).rejects.toThrow(
      /178\.104\.195\.59.*178\.105\.239\.144|178\.105\.239\.144.*178\.104\.195\.59/s,
    )
  })

  it('mismatch error names the file path, both addresses, and the --inventory override', async () => {
    const invPath = join(dir, 'ansible-inventory.ini')
    writeFileSync(invPath, '[martialops]\n178.104.195.59 ansible_user=root\n')
    const config = { ...baseConfig, serverIp: '178.105.239.144' }

    await expect(resolveInventoryPath('martialops', config)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/178\.104\.195\.59/),
      }),
    )
    try {
      await resolveInventoryPath('martialops', config)
      expect.unreachable()
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain(invPath)
      expect(message).toContain('178.104.195.59')
      expect(message).toContain('178.105.239.144')
      expect(message).toContain('--inventory')
    }
  })

  it('refuses a multi-host inventory rather than guessing', async () => {
    writeFileSync(
      join(dir, 'ansible-inventory.ini'),
      '[web]\n178.105.239.144\n\n[other]\n167.233.43.96\n',
    )
    const config = { ...baseConfig, serverIp: '178.105.239.144' }

    await expect(resolveInventoryPath('martialops', config)).rejects.toThrow(/multiple hosts/)
  })

  it('falls back to terraform output when config.serverIp is absent', async () => {
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[emit-social]\n167.233.169.206 ansible_user=root\n')
    vi.mocked(getTerraformOutput).mockResolvedValue('167.233.169.206')

    const result = await resolveInventoryPath('emit-social', { ...baseConfig, serverIp: undefined })

    expect(result).toBe(join(dir, 'ansible-inventory.ini'))
    expect(getTerraformOutput).toHaveBeenCalledWith('server_ip', join(dir, 'terraform'))
  })

  it('throws when terraform output disagrees with the inventory', async () => {
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[emit-social]\n167.233.169.206 ansible_user=root\n')
    vi.mocked(getTerraformOutput).mockResolvedValue('9.9.9.9')

    await expect(resolveInventoryPath('emit-social', { ...baseConfig, serverIp: undefined })).rejects.toThrow(
      /9\.9\.9\.9/,
    )
  })

  it('proceeds with a visible note when neither serverIp nor terraform output is available', async () => {
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[emit-social]\n167.233.169.206 ansible_user=root\n')
    vi.mocked(getTerraformOutput).mockResolvedValue(null)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await resolveInventoryPath('emit-social', { ...baseConfig, serverIp: undefined })

    expect(result).toBe(join(dir, 'ansible-inventory.ini'))
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('skipping inventory validation')
    logSpy.mockRestore()
  })
})

describe('configure command — --inventory bypasses resolveInventoryPath', () => {
  let dir: string
  let originalCwd: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'configure-cmd-')))
    originalCwd = process.cwd()
    process.chdir(dir)
    vi.clearAllMocks()
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig } as ReturnType<typeof loadConfig>)
    vi.mocked(runAnsible).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses the explicit --inventory path even when it would mismatch a present ansible-inventory.ini', async () => {
    // A local ansible-inventory.ini exists and would fail validation, but
    // --inventory is the deliberate-override escape hatch and must skip
    // resolveInventoryPath (and its validation) entirely.
    writeFileSync(join(dir, 'ansible-inventory.ini'), '[martialops]\n178.104.195.59 ansible_user=root\n')
    const overridePath = join(dir, 'override-inventory.ini')
    writeFileSync(overridePath, '[martialops]\n178.105.239.144 ansible_user=root\n')

    const program = new Command()
    program.exitOverride()
    registerConfigure(program)

    await program.parseAsync(['node', 'cli', 'configure', '--inventory', overridePath])

    expect(runAnsible).toHaveBeenCalledOnce()
    expect(runAnsible).toHaveBeenCalledWith('provision', overridePath, expect.anything())
  })
})

describe('deploy inherits the inventory check through the shared import', () => {
  it('imports resolveInventoryPath from configure.ts, not a local copy', async () => {
    const deploySource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./deploy.ts', import.meta.url), 'utf8'),
    )
    expect(deploySource).toMatch(/import\s*\{\s*resolveInventoryPath\s*\}\s*from\s*['"]\.\/configure\.js['"]/)
  })
})
