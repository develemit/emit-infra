import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import {
  registerSecretsScaffold,
  parseKeyList,
  filterExcludedKeys,
  diffKeys,
  resolveConfigPath,
} from './secrets-scaffold.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  sshExec: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}))

import { loadConfig, sshExec } from '@emit-infra/core'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  serverIp: '1.2.3.4',
  sshKeyName: 'emit-deploy',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
})

describe('pure helpers', () => {
  describe('parseKeyList', () => {
    it('splits on newlines and drops blank lines', () => {
      expect(parseKeyList('KEY1\nKEY2\n\nKEY3\n')).toEqual(['KEY1', 'KEY2', 'KEY3'])
    })

    it('trims whitespace', () => {
      expect(parseKeyList('  KEY1  \n KEY2 ')).toEqual(['KEY1', 'KEY2'])
    })
  })

  describe('filterExcludedKeys', () => {
    it('drops BUILD_NUMBER', () => {
      expect(filterExcludedKeys(['KEY1', 'BUILD_NUMBER', 'KEY2'])).toEqual(['KEY1', 'KEY2'])
    })

    it('is a no-op when nothing is excluded', () => {
      expect(filterExcludedKeys(['KEY1', 'KEY2'])).toEqual(['KEY1', 'KEY2'])
    })
  })

  describe('diffKeys', () => {
    it('reports added and removed keys', () => {
      expect(diffKeys(['A', 'B'], ['B', 'C'])).toEqual({ added: ['C'], removed: ['A'] })
    })

    it('reports no diff for identical sets', () => {
      expect(diffKeys(['A', 'B'], ['B', 'A'])).toEqual({ added: [], removed: [] })
    })
  })

  describe('resolveConfigPath', () => {
    it('returns the explicit path when given', () => {
      expect(resolveConfigPath('/some/path/.emit-infra.json')).toBe('/some/path/.emit-infra.json')
    })

    it('finds .emit-infra.json in the current directory', () => {
      vi.mocked(existsSync).mockImplementation((p) => String(p) === `${process.cwd()}/.emit-infra.json`)
      expect(resolveConfigPath()).toBe(`${process.cwd()}/.emit-infra.json`)
    })

    it('throws when no config file is found', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      expect(() => resolveConfigPath()).toThrow(/Could not find/)
    })
  })
})

describe('secrets scaffold-required-keys command', () => {
  it('--dry-run prints keys without writing', async () => {
    vi.mocked(sshExec).mockResolvedValue('KEY1\nBUILD_NUMBER\nKEY2\n')

    const program = new Command()
    program.exitOverride()
    const secretsCmd = program.command('secrets')
    registerSecretsScaffold(secretsCmd)
    await program.parseAsync(['node', 'cli', 'secrets', 'scaffold-required-keys', 'test-project', '--dry-run'])

    expect(sshExec).toHaveBeenCalledWith('1.2.3.4', expect.stringContaining('/opt/test-project/.env'), '/home/test/.ssh/emit-deploy')
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('writes sorted requiredEnvKeys, excluding BUILD_NUMBER', async () => {
    vi.mocked(sshExec).mockResolvedValue('ZKEY\nBUILD_NUMBER\nAKEY\n')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'test-project' }))

    const program = new Command()
    program.exitOverride()
    const secretsCmd = program.command('secrets')
    registerSecretsScaffold(secretsCmd)
    await program.parseAsync(['node', 'cli', 'secrets', 'scaffold-required-keys', 'test-project'])

    expect(writeFileSync).toHaveBeenCalledTimes(1)
    const [, written] = vi.mocked(writeFileSync).mock.calls[0]!
    const parsed = JSON.parse(written as string)
    expect(parsed.requiredEnvKeys).toEqual(['AKEY', 'ZKEY'])
  })

  it('refuses to overwrite an existing requiredEnvKeys without --force', async () => {
    vi.mocked(sshExec).mockResolvedValue('AKEY\nBKEY\n')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'test-project', requiredEnvKeys: ['AKEY', 'CKEY'] }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    const secretsCmd = program.command('secrets')
    registerSecretsScaffold(secretsCmd)

    await expect(
      program.parseAsync(['node', 'cli', 'secrets', 'scaffold-required-keys', 'test-project']),
    ).rejects.toThrow('process.exit')

    expect(writeFileSync).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('overwrites an existing requiredEnvKeys with --force', async () => {
    vi.mocked(sshExec).mockResolvedValue('AKEY\nBKEY\n')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'test-project', requiredEnvKeys: ['AKEY', 'CKEY'] }))

    const program = new Command()
    program.exitOverride()
    const secretsCmd = program.command('secrets')
    registerSecretsScaffold(secretsCmd)
    await program.parseAsync(['node', 'cli', 'secrets', 'scaffold-required-keys', 'test-project', '--force'])

    expect(writeFileSync).toHaveBeenCalledTimes(1)
    const [, written] = vi.mocked(writeFileSync).mock.calls[0]!
    const parsed = JSON.parse(written as string)
    expect(parsed.requiredEnvKeys).toEqual(['AKEY', 'BKEY'])
  })

  it('fails clearly and writes nothing when the host is unreachable', async () => {
    vi.mocked(sshExec).mockRejectedValue(new Error('ssh failed'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    const secretsCmd = program.command('secrets')
    registerSecretsScaffold(secretsCmd)

    await expect(
      program.parseAsync(['node', 'cli', 'secrets', 'scaffold-required-keys', 'test-project']),
    ).rejects.toThrow('process.exit')

    expect(writeFileSync).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})
