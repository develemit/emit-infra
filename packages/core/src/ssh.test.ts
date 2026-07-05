/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 }),
}))

import { execa } from 'execa'
import { sshExec, sshMuxArgs } from './ssh.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

const mockedExeca = vi.mocked(execa)

beforeEach(() => {
  mockedExeca.mockClear()
})

describe('sshMuxArgs', () => {
  it('returns 6 elements for ControlMaster, ControlPath, ControlPersist', () => {
    const args = sshMuxArgs()
    expect(args).toHaveLength(6)
    expect(args[0]).toBe('-o')
    expect(args[1]).toBe('ControlMaster=auto')
    expect(args[2]).toBe('-o')
    expect(args[3]).toBe(`ControlPath=${join(homedir(), '.ssh', 'emit-infra-cm', '%C')}`)
    expect(args[4]).toBe('-o')
    expect(args[5]).toBe('ControlPersist=60')
  })
})

describe('sshExec', () => {
  it('passes the exact arg array with host and command as separate elements', async () => {
    await sshExec('1.2.3.4', 'docker ps', '/keys/deploy')

    expect(mockedExeca).toHaveBeenCalledOnce()
    const call = mockedExeca.mock.calls[0] as any
    expect(call[0]).toBe('ssh')
    expect(call[1]).toEqual([
      '-i', '/keys/deploy',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${join(homedir(), '.ssh', 'emit-infra-cm', '%C')}`,
      '-o', 'ControlPersist=60',
      'root@1.2.3.4',
      'docker ps',
    ])
  })

  it('returns stdout from the command', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: 'output-line', stderr: '', exitCode: 0 } as any)
    const result = await sshExec('host', 'cmd', '/key')
    expect(result).toBe('output-line')
  })

  it('proves command is a single array element (not split by spaces)', async () => {
    await sshExec('host', 'cat /etc/hosts && echo done', '/key')
    const args = (mockedExeca.mock.calls[0] as any)[1] as string[]
    const lastArg = args[args.length - 1]
    expect(lastArg).toBe('cat /etc/hosts && echo done')
  })

  it('proves host is a single element prefixed with root@', async () => {
    await sshExec('my.server.com', 'whoami', '/key')
    const args = (mockedExeca.mock.calls[0] as any)[1] as string[]
    const hostArg = args[args.length - 2]
    expect(hostArg).toBe('root@my.server.com')
  })
})
