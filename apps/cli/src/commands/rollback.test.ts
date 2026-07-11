import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { registerRollback } from './rollback.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  sshExec: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}))

import { loadConfig, sshExec } from '@emit-infra/core'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  serverIp: '1.2.3.4',
  sshKeyName: 'emit-deploy',
  deploy: { appDir: '/app', composeDest: 'docker-compose.yml', appPort: '3000' },
}

const host = '1.2.3.4'
const key = '/home/test/.ssh/emit-deploy'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
})

describe('rollback command', () => {
  it('exits without executing when image list is empty', async () => {
    vi.mocked(sshExec).mockResolvedValueOnce('')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    registerRollback(program)

    await expect(program.parseAsync(['node', 'cli', 'rollback'])).rejects.toThrow('process.exit')
    expect(vi.mocked(sshExec)).toHaveBeenCalledOnce()
    exitSpy.mockRestore()
  })

  it('default rollback: reads images, checks :rollback tag, re-tags, restarts, health-checks', async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce('myrepo/web:latest')
      .mockResolvedValueOnce('')  // check rollback tags — resolves means tags exist
      .mockResolvedValueOnce('')  // docker tag
      .mockResolvedValueOnce('')  // compose up
      .mockResolvedValueOnce('healthy')

    const program = new Command()
    program.exitOverride()
    registerRollback(program)
    await program.parseAsync(['node', 'cli', 'rollback'])

    const calls = vi.mocked(sshExec).mock.calls
    expect(calls[0]).toEqual([host, 'cd /app && docker compose -f docker-compose.yml config --images', key])
    expect(calls[1]).toEqual([host, 'docker image inspect "myrepo/web:rollback" > /dev/null 2>&1', key])
    expect(calls[2]).toEqual([host, 'docker tag "myrepo/web:rollback" "myrepo/web:latest"', key])
    expect(calls[3]).toEqual([host, 'cd /app && docker compose -f docker-compose.yml up -d --remove-orphans', key])
    expect(calls[4]).toEqual([host, '/app/health-check.sh 3000 10', key])
  })

  it('--version: pulls and tags specified build number as :latest', async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce('myrepo/web:latest')
      .mockResolvedValueOnce('')  // pull+tag
      .mockResolvedValueOnce('')  // compose up
      .mockResolvedValueOnce('healthy')

    const program = new Command()
    program.exitOverride()
    registerRollback(program)
    await program.parseAsync(['node', 'cli', 'rollback', '--version', '42'])

    expect(vi.mocked(sshExec).mock.calls[1]).toEqual([
      host,
      'docker pull "myrepo/web:42" && docker tag "myrepo/web:42" "myrepo/web:latest"',
      key,
    ])
    expect(vi.mocked(sshExec).mock.calls[2]).toEqual([host, 'cd /app && docker compose -f docker-compose.yml up -d --remove-orphans', key])
  })

  it('--timestamp: tags snapshot as :latest then restarts', async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce('myrepo/web:latest')
      .mockResolvedValueOnce('')  // tag
      .mockResolvedValueOnce('')  // compose up
      .mockResolvedValueOnce('healthy')

    const program = new Command()
    program.exitOverride()
    registerRollback(program)
    await program.parseAsync(['node', 'cli', 'rollback', '--timestamp', 'rollback-20260611T221443'])

    expect(vi.mocked(sshExec).mock.calls[1]).toEqual([
      host,
      'docker tag "myrepo/web:rollback-20260611T221443" "myrepo/web:latest"',
      key,
    ])
  })

  it('--list: queries docker images without restarting', async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce('myrepo/web:latest')
      .mockResolvedValueOnce('myrepo/web:rollback-20260611T221443')

    const program = new Command()
    program.exitOverride()
    registerRollback(program)
    await program.parseAsync(['node', 'cli', 'rollback', '--list'])

    expect(vi.mocked(sshExec)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sshExec).mock.calls[1]).toEqual([
      host,
      '{ docker images --format "{{.Repository}}:{{.Tag}}" "myrepo/web" | grep ":rollback-"; } | sort -u -r',
      key,
    ])
  })

  it('uses config.domain as host when serverIp is absent', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...baseConfig,
      serverIp: undefined,
    } as unknown as ReturnType<typeof loadConfig>)
    vi.mocked(sshExec)
      .mockResolvedValueOnce('myrepo/web:latest')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('healthy')

    const program = new Command()
    program.exitOverride()
    registerRollback(program)
    await program.parseAsync(['node', 'cli', 'rollback'])

    expect(vi.mocked(sshExec).mock.calls[0]![0]).toBe('test.com')
  })
})
