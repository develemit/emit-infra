/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { runAnsible } from './ansible.js'

const mockedExeca = vi.mocked(execa)

function makeProc(exitCode: number, stdoutLines: string[] = [], stderrLines: string[] = []) {
  const stdout = Readable.from(stdoutLines.map((l) => l + '\n'))
  const stderr = Readable.from(stderrLines.map((l) => l + '\n'))
  const promise = new Promise((resolve) => {
    const check = () => {
      if (stdout.destroyed || stdout.readableEnded) resolve({ exitCode, stdout: '', stderr: '' })
      else stdout.once('end', () => resolve({ exitCode, stdout: '', stderr: '' }))
    }
    setImmediate(check)
  })
  return Object.assign(promise, { stdout, stderr }) as any
}

beforeEach(() => {
  mockedExeca.mockReset()
  mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any)
})

describe('runAnsible', () => {
  it('passes playbook path and inventory as args', async () => {
    await runAnsible('deploy', '/inv/hosts')

    expect(mockedExeca).toHaveBeenCalledOnce()
    const call = mockedExeca.mock.calls[0] as any
    expect(call[0]).toBe('ansible-playbook')
    expect(call[1][0]).toMatch(/ansible\/playbooks\/deploy\.yml$/)
    expect(call[1][1]).toBe('-i')
    expect(call[1][2]).toBe('/inv/hosts')
  })

  it('appends --extra-vars with JSON-serialized object', async () => {
    const vars = { build_number: '42', app_name: 'test' }
    await runAnsible('provision', '/inv/hosts', vars)

    const args = (mockedExeca.mock.calls[0] as any)[1] as string[]
    expect(args).toContain('--extra-vars')
    const idx = args.indexOf('--extra-vars')
    expect(args[idx + 1]).toBe(JSON.stringify(vars))
  })

  it('sets ANSIBLE_HOST_KEY_CHECKING=False in env', async () => {
    await runAnsible('deploy', '/inv/hosts')

    const opts = (mockedExeca.mock.calls[0] as any)[2]
    expect(opts.env.ANSIBLE_HOST_KEY_CHECKING).toBe('False')
  })

  it('uses stdio inherit when no onLine provided', async () => {
    await runAnsible('deploy', '/inv/hosts')

    const opts = (mockedExeca.mock.calls[0] as any)[2]
    expect(opts.stdio).toBe('inherit')
  })

  it('streams stdout and stderr lines to onLine callback', async () => {
    mockedExeca.mockReturnValueOnce(makeProc(0, ['line1', 'line2'], ['err1']))

    const lines: Array<{ stream: string; text: string }> = []
    await runAnsible('deploy', '/inv/hosts', undefined, (stream, text) => {
      lines.push({ stream, text })
    })

    expect(lines).toContainEqual({ stream: 'stdout', text: 'line1' })
    expect(lines).toContainEqual({ stream: 'stdout', text: 'line2' })
    expect(lines).toContainEqual({ stream: 'stderr', text: 'err1' })
  })

  it('throws on non-zero exit in streaming mode', async () => {
    mockedExeca.mockReturnValueOnce(makeProc(2))

    await expect(
      runAnsible('deploy', '/inv/hosts', undefined, () => {}),
    ).rejects.toThrow('ansible-playbook exited with code 2')
  })
})
