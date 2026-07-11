import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { registerSecretsSync } from './secrets-sync.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}))

import { loadConfig } from '@emit-infra/core'
import { existsSync, readFileSync } from 'node:fs'
import { execa } from 'execa'

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
})

describe('secrets-sync command', () => {
  it('exits without executing when env file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)

    await expect(program.parseAsync(['node', 'cli', 'secrets', 'sync'])).rejects.toThrow('process.exit')
    expect(execa).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('calls gh secret set for each env entry', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1\nKEY2=val2\n# comment\n\nKEY3=val3')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync'])

    expect(execa).toHaveBeenCalledTimes(3)
    expect(execa).toHaveBeenNthCalledWith(1, 'gh', ['secret', 'set', 'KEY1', '--repo', 'user/test'], { input: 'val1' })
    expect(execa).toHaveBeenNthCalledWith(2, 'gh', ['secret', 'set', 'KEY2', '--repo', 'user/test'], { input: 'val2' })
    expect(execa).toHaveBeenNthCalledWith(3, 'gh', ['secret', 'set', 'KEY3', '--repo', 'user/test'], { input: 'val3' })
  })

  it('--dry-run: does not call gh secret set', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--dry-run'])

    expect(execa).not.toHaveBeenCalled()
  })

  it('--env-file: uses the specified path', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('MYKEY=myval')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--env-file', '.env.staging'])

    expect(execa).toHaveBeenCalledWith('gh', ['secret', 'set', 'MYKEY', '--repo', 'user/test'], { input: 'myval' })
  })

  it('strips quotes from env values', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('TOKEN="abc123"\nPASS=\'xyz\'')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync'])

    expect(execa).toHaveBeenNthCalledWith(1, 'gh', ['secret', 'set', 'TOKEN', '--repo', 'user/test'], { input: 'abc123' })
    expect(execa).toHaveBeenNthCalledWith(2, 'gh', ['secret', 'set', 'PASS', '--repo', 'user/test'], { input: 'xyz' })
  })
})
