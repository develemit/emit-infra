import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { join } from 'node:path'
import { registerProvision } from './provision.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  runTerraform: vi.fn(),
}))

import { loadConfig, runTerraform } from '@emit-infra/core'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/test' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
  vi.mocked(runTerraform).mockResolvedValue(undefined)
})

describe('provision command', () => {
  it('runs terraform init then apply with -auto-approve by default', async () => {
    const program = new Command()
    program.exitOverride()
    registerProvision(program)

    await program.parseAsync(['node', 'cli', 'provision'])

    const tfDir = join(process.cwd(), 'terraform')
    expect(runTerraform).toHaveBeenCalledTimes(2)
    expect(runTerraform).toHaveBeenNthCalledWith(1, 'init', [], tfDir)
    expect(runTerraform).toHaveBeenNthCalledWith(2, 'apply', ['-auto-approve'], tfDir)
  })

  it('runs terraform init then plan (no apply) with --plan-only', async () => {
    const program = new Command()
    program.exitOverride()
    registerProvision(program)

    await program.parseAsync(['node', 'cli', 'provision', '--plan-only'])

    const tfDir = join(process.cwd(), 'terraform')
    expect(runTerraform).toHaveBeenCalledTimes(2)
    expect(runTerraform).toHaveBeenNthCalledWith(1, 'init', [], tfDir)
    expect(runTerraform).toHaveBeenNthCalledWith(2, 'plan', [], tfDir)
  })

  it('does not call apply when --plan-only is set', async () => {
    const program = new Command()
    program.exitOverride()
    registerProvision(program)

    await program.parseAsync(['node', 'cli', 'provision', '--plan-only'])

    const applyCalls = vi.mocked(runTerraform).mock.calls.filter(c => c[0] === 'apply')
    expect(applyCalls).toHaveLength(0)
  })
})
