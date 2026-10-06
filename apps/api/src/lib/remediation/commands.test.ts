import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { EMIT_INFRA_COMMANDS, remediate, type Finding } from './index.js'

const base = { project: 'app', serverIp: '203.0.113.5' }
const findings: Finding[] = [
  { ...base, kind: 'disk', pct: 95 },
  { ...base, kind: 'mem', pct: 95 },
  { ...base, kind: 'cert', daysLeft: 3, error: 'x' },
  { ...base, kind: 'cert' },
  { ...base, kind: 'backup', ageHours: 60, status: 'failed' },
  ...[undefined, 500, 502, 504, 526].map((status): Finding => ({ ...base, kind: 'health', check: 'http', status })),
  { ...base, kind: 'health', check: 'ssh' },
  { ...base, kind: 'health', check: 'http', recovered: true, durationMs: 60_000 },
  ...['docker build failed TS2322', 'TLS handshake timeout', 'health check failed after switch', 'odd'].map((error): Finding => ({ ...base, kind: 'deploy-failed', sha: 'abcdef1234', error })),
  { ...base, kind: 'incidents', count: 4 },
]

const allCommands = findings.flatMap((f) => remediate(f).steps.flatMap((s) => (s.command ? [s.command] : [])))

describe('remediation commands', () => {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../cli/src')
  const registered = (): Set<string> => {
    const names = new Set<string>()
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name))
        else if (e.name.endsWith('.ts')) for (const m of readFileSync(join(dir, e.name), 'utf8').matchAll(/\.command\('([\w:-]+)/g)) names.add(m[1]!)
      }
    }
    walk(cliDir)
    return names
  }

  it('the shared list only names commands the CLI registers', () => {
    const real = registered()
    for (const c of EMIT_INFRA_COMMANDS) expect(real, c).toContain(c)
  })

  it('every emit-infra subcommand used is registered', () => {
    const used = allCommands.flatMap((c) => [...c.matchAll(/emit-infra ([\w:-]+)/g)].map((m) => m[1]!))
    expect(used.length).toBeGreaterThan(5)
    for (const u of used) expect(EMIT_INFRA_COMMANDS as readonly string[], u).toContain(u)
  })

  it('no command uses a relative projects/ path', () => {
    for (const c of allCommands) expect(c, c).not.toMatch(/(^|[\s"'])projects\//)
  })
})
