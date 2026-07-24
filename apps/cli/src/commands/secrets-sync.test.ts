import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { registerSecretsSync, diffEnvSources } from './secrets-sync.js'

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

const mockRl = {
  question: vi.fn(),
  close: vi.fn(),
}

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => mockRl),
}))

import { loadConfig } from '@emit-infra/core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { createInterface } from 'node:readline'

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
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--yes'])

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
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--env-file', '.env.staging', '--yes'])

    expect(execa).toHaveBeenCalledWith('gh', ['secret', 'set', 'MYKEY', '--repo', 'user/test'], { input: 'myval' })
  })

  it('strips quotes from env values', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('TOKEN="abc123"\nPASS=\'xyz\'')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--yes'])

    expect(execa).toHaveBeenNthCalledWith(1, 'gh', ['secret', 'set', 'TOKEN', '--repo', 'user/test'], { input: 'abc123' })
    expect(execa).toHaveBeenNthCalledWith(2, 'gh', ['secret', 'set', 'PASS', '--repo', 'user/test'], { input: 'xyz' })
  })

  it('--yes flag bypasses confirmation', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1')

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--yes'])

    expect(createInterface).not.toHaveBeenCalled()
    expect(execa).toHaveBeenCalledTimes(1)
  })

  it('without --yes, user confirms and sync proceeds', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1')

    mockRl.question.mockImplementation((_prompt, callback) => {
      callback('y')
    })

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync'])

    expect(mockRl.question).toHaveBeenCalled()
    expect(mockRl.close).toHaveBeenCalled()
    expect(execa).toHaveBeenCalledTimes(1)
  })

  it('without --yes, user denies and sync is aborted', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1')

    mockRl.question.mockImplementation((_prompt, callback) => {
      callback('n')
    })

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync'])

    expect(mockRl.question).toHaveBeenCalled()
    expect(mockRl.close).toHaveBeenCalled()
    expect(execa).not.toHaveBeenCalled()
  })

  it('warns when the deploy-resolved env source differs from the synced file', async () => {
    const cwd = process.cwd()
    const syncPath = join(cwd, '.env.prod')
    const deployPath = join(cwd, 'infra/secrets.prod.env')

    vi.mocked(loadConfig).mockReturnValue({
      ...baseConfig,
      ci: { envFile: 'infra/secrets.prod.env' },
    } as ReturnType<typeof loadConfig>)
    vi.mocked(existsSync).mockImplementation((p) => p === syncPath || p === deployPath)
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (p === syncPath) return 'SHARED=local-value\nONLY_SYNC=x'
      if (p === deployPath) return 'SHARED=server-value\nONLY_DEPLOY=y'
      return ''
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--dry-run'])

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('deploy reads a different env file than sync')
    expect(output).toContain('ONLY_SYNC')
    expect(output).toContain('ONLY_DEPLOY')
    expect(output).toContain('SHARED')
    expect(output).not.toContain('local-value')
    expect(output).not.toContain('server-value')

    logSpy.mockRestore()
  })

  it('does not warn when sync and deploy resolve to the same file', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('KEY1=val1')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const program = new Command()
    program.exitOverride()
    registerSecretsSync(program)
    await program.parseAsync(['node', 'cli', 'secrets', 'sync', '--dry-run'])

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).not.toContain('deploy reads a different env file than sync')

    logSpy.mockRestore()
  })
})

describe('diffEnvSources', () => {
  it('reports keys only present in the sync source', () => {
    const diff = diffEnvSources([['A', '1'], ['B', '2']], [['A', '1']])
    expect(diff.onlyInSync).toEqual(['B'])
    expect(diff.onlyInDeploy).toEqual([])
    expect(diff.differing).toEqual([])
  })

  it('reports keys only present in the deploy source', () => {
    const diff = diffEnvSources([['A', '1']], [['A', '1'], ['C', '3']])
    expect(diff.onlyInSync).toEqual([])
    expect(diff.onlyInDeploy).toEqual(['C'])
    expect(diff.differing).toEqual([])
  })

  it('reports keys whose values differ between the two sources', () => {
    const diff = diffEnvSources([['A', 'local']], [['A', 'server']])
    expect(diff.onlyInSync).toEqual([])
    expect(diff.onlyInDeploy).toEqual([])
    expect(diff.differing).toEqual(['A'])
  })

  it('returns no differences for identical env files', () => {
    const diff = diffEnvSources([['A', '1'], ['B', '2']], [['A', '1'], ['B', '2']])
    expect(diff).toEqual({ onlyInSync: [], onlyInDeploy: [], differing: [] })
  })

  it('returns no differences when both sources are empty', () => {
    const diff = diffEnvSources([], [])
    expect(diff).toEqual({ onlyInSync: [], onlyInDeploy: [], differing: [] })
  })
})
