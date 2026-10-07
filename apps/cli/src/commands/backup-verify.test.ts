import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, mkdtemp: vi.fn(async () => '/tmp/bv-test'), rm: vi.fn(async () => undefined), stat: vi.fn(async () => ({ size: 42 })) }
})

import { execa } from 'execa'
import { runDrill } from './backup-verify.js'

const CREDS = { bucket: 'b', endpoint: 'https://e', accessKeyId: 'k', secretAccessKey: 's', source: 'test' }
const INPUT = { name: 'x', creds: CREDS, prefixes: ['db-backups/'], verifyQueries: [], pgMajor: '16' }
const LISTING = '2026-10-06 16:05:16   100 x_20261006_230513.dump\n'

type Handler = (args: string[]) => { stdout?: string; exitCode?: number } | Error

function mockCommands(onDocker: Handler): void {
  vi.mocked(execa).mockImplementation(((cmd: string, args: string[] = []) => {
    if (cmd === 'aws') return Promise.resolve({ stdout: args[1] === 'ls' ? LISTING : '', stderr: '', exitCode: 0 })
    const r = onDocker(args)
    if (r instanceof Error) return Promise.reject(r)
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0, ...r })
  }) as never)
}

const removed = (): boolean =>
  vi.mocked(execa).mock.calls.some(([cmd, args]) => cmd === 'docker' && (args as string[])[0] === 'rm' && (args as string[]).includes('cid1'))

const okHandler: Handler = (args) => {
  if (args[0] === 'run') return { stdout: 'cid1\n' }
  if (args.includes('psql')) return { stdout: args.at(-1)?.startsWith('select count') ? '5' : 'public.t|3' }
  return {}
}

beforeEach(() => vi.mocked(execa).mockReset())

describe('runDrill container cleanup', () => {
  it('removes the container after a successful drill', async () => {
    mockCommands(okHandler)
    const result = await runDrill(INPUT)
    expect(result).toMatchObject({ ok: true, tables: 5, bytes: 42, key: 'db-backups/x_20261006_230513.dump' })
    expect(removed()).toBe(true)
  })

  it('removes the container and reports the error when the restore fails', async () => {
    mockCommands((args) => (args.includes('pg_restore') ? new Error('restore blew up') : okHandler(args)))
    const result = await runDrill(INPUT)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/restore blew up/)
    expect(removed()).toBe(true)
  })

  it('removes the container when a later step throws unexpectedly', async () => {
    mockCommands((args) => (args.includes('psql') ? new Error('boom') : okHandler(args)))
    const result = await runDrill(INPUT)
    expect(result.ok).toBe(false)
    expect(removed()).toBe(true)
  })

  it('fails a drill whose restore produced no tables', async () => {
    mockCommands((args) => (args.includes('psql') ? { stdout: '0' } : okHandler(args)))
    const result = await runDrill(INPUT)
    expect(result).toMatchObject({ ok: false, error: 'restore produced no user tables' })
    expect(removed()).toBe(true)
  })

  it('fails when a verify query returns no rows', async () => {
    mockCommands((args) => (args.at(-1) === 'select 1 from users' ? { stdout: '' } : okHandler(args)))
    const result = await runDrill({ ...INPUT, verifyQueries: ['select 1 from users'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/verify query returned no rows/)
  })
})
