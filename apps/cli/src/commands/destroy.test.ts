import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { join } from 'node:path'
import { registerDestroy } from './destroy.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  runTerraform: vi.fn(),
}))

vi.mock('node:readline', () => ({
  createInterface: vi.fn(),
}))

import { loadConfig, runTerraform } from '@emit-infra/core'
import { createInterface } from 'node:readline'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/test' },
}

function mockReadline(answer: string) {
  vi.mocked(createInterface).mockReturnValue({
    question: vi.fn().mockImplementation((_prompt: string, cb: (a: string) => void) => cb(answer)),
    close: vi.fn(),
  } as unknown as ReturnType<typeof createInterface>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
  vi.mocked(runTerraform).mockResolvedValue(undefined)
})

describe('destroy command', () => {
  it('does not call runTerraform when confirmation is declined', async () => {
    mockReadline('wrong-answer')

    const program = new Command()
    program.exitOverride()
    registerDestroy(program)

    await program.parseAsync(['node', 'cli', 'destroy'])

    expect(runTerraform).not.toHaveBeenCalled()
  })

  it('does not call runTerraform when confirmation is empty', async () => {
    mockReadline('')

    const program = new Command()
    program.exitOverride()
    registerDestroy(program)

    await program.parseAsync(['node', 'cli', 'destroy'])

    expect(runTerraform).not.toHaveBeenCalled()
  })

  it('calls terraform destroy when confirmation matches project name', async () => {
    mockReadline('test-project')

    const program = new Command()
    program.exitOverride()
    registerDestroy(program)

    await program.parseAsync(['node', 'cli', 'destroy'])

    const tfDir = join(process.cwd(), 'terraform')
    expect(runTerraform).toHaveBeenCalledWith('destroy', ['-auto-approve'], tfDir)
  })

  it('skips confirmation prompt and calls destroy with --yes flag', async () => {
    const program = new Command()
    program.exitOverride()
    registerDestroy(program)

    await program.parseAsync(['node', 'cli', 'destroy', '--yes'])

    expect(createInterface).not.toHaveBeenCalled()
    const tfDir = join(process.cwd(), 'terraform')
    expect(runTerraform).toHaveBeenCalledWith('destroy', ['-auto-approve'], tfDir)
  })
})
