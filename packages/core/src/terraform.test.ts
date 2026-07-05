/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { runTerraform, getTerraformOutput } from './terraform.js'

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

describe('runTerraform', () => {
  it('passes cmd and args with cwd option', async () => {
    await runTerraform('apply', ['-auto-approve', '-input=false'], '/tf/project')

    expect(mockedExeca).toHaveBeenCalledOnce()
    const call = mockedExeca.mock.calls[0] as any
    expect(call[0]).toBe('terraform')
    expect(call[1]).toEqual(['apply', '-auto-approve', '-input=false'])
    expect(call[2].cwd).toBe('/tf/project')
  })

  it('uses stdio inherit when no onLine provided', async () => {
    await runTerraform('plan', [], '/tf')

    const opts = (mockedExeca.mock.calls[0] as any)[2]
    expect(opts.stdio).toBe('inherit')
  })

  it('streams stdout and stderr lines to onLine callback', async () => {
    mockedExeca.mockReturnValueOnce(makeProc(0, ['Applying...', 'Done.'], ['Warning: foo']))

    const lines: Array<{ stream: string; text: string }> = []
    await runTerraform('apply', [], '/tf', (stream, text) => {
      lines.push({ stream, text })
    })

    expect(lines).toContainEqual({ stream: 'stdout', text: 'Applying...' })
    expect(lines).toContainEqual({ stream: 'stdout', text: 'Done.' })
    expect(lines).toContainEqual({ stream: 'stderr', text: 'Warning: foo' })
  })

  it('throws on non-zero exit in streaming mode', async () => {
    mockedExeca.mockReturnValueOnce(makeProc(1))

    await expect(
      runTerraform('apply', [], '/tf', () => {}),
    ).rejects.toThrow('terraform exited with code 1')
  })
})

describe('getTerraformOutput', () => {
  it('calls terraform output -raw with key and cwd', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: '10.0.0.1', stderr: '', exitCode: 0 } as any)

    await getTerraformOutput('server_ip', '/tf/project')

    const call = mockedExeca.mock.calls[0] as any
    expect(call[0]).toBe('terraform')
    expect(call[1]).toEqual(['output', '-raw', 'server_ip'])
    expect(call[2].cwd).toBe('/tf/project')
  })

  it('trims whitespace from stdout', async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: '  10.0.0.1  \n', stderr: '', exitCode: 0 } as any)

    const result = await getTerraformOutput('server_ip', '/tf')
    expect(result).toBe('10.0.0.1')
  })
})
