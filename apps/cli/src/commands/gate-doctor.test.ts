import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findEnvPrefixFindings } from '../lib/gate-doctor-static.js'
import { scrubbedHookEnv } from '../lib/gate-doctor-env.js'
import { reportHasIssues, type ProjectGateReport } from '../lib/gate-doctor-report.js'
import type { GateProject } from '../lib/gate-doctor-scan.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

import { execa } from 'execa'
import { runGateTarget } from '../lib/gate-doctor-run.js'
import { buildGateReport } from './gate-doctor.js'

// ─── static parser ──────────────────────────────────────────────────────────

describe('findEnvPrefixFindings', () => {
  it('flags an env var prefixed onto a CI command — tastease\'s removed line', () => {
    const content = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SKIP_ENV_VALIDATION=1 pnpm nx affected -t build --base=origin/main',
    ].join('\n')

    const findings = findEnvPrefixFindings('scripts/ci.sh', content)

    expect(findings).toEqual([
      {
        file: 'scripts/ci.sh',
        line: 3,
        text: 'SKIP_ENV_VALIDATION=1 pnpm nx affected -t build --base=origin/main',
        envVars: ['SKIP_ENV_VALIDATION'],
      },
    ])
  })

  it('flags multiple assignments prefixed onto one command', () => {
    const findings = findEnvPrefixFindings('ci.sh', 'FOO=1 BAR=2 pnpm nx affected -t test')
    expect(findings[0]?.envVars).toEqual(['FOO', 'BAR'])
  })

  it('does not flag a bare assignment with no trailing command', () => {
    expect(findEnvPrefixFindings('ci.sh', 'TARGET=build')).toEqual([])
  })

  it('does not flag comment lines', () => {
    expect(findEnvPrefixFindings('ci.sh', '# SKIP_ENV_VALIDATION=1 pnpm nx affected -t build')).toEqual([])
  })

  it('does not flag a plain command with no prefix', () => {
    expect(findEnvPrefixFindings('ci.sh', 'pnpm nx affected -t build --base=origin/main')).toEqual([])
  })

  it('does not flag a quoted-subshell assignment as a prefix — develemail/ci.sh shape', () => {
    expect(findEnvPrefixFindings('ci.sh', 'ROOT="$(cd "$(dirname "$0")/.." && pwd)"')).toEqual([])
  })

  it('does not flag a self-computed value diner-decider legitimately passes to its own container', () => {
    const findings = findEnvPrefixFindings('ci.sh', 'DATABASE_URL="$CI_DB_URL" pnpm nx run-many -t test')
    expect(findings).toEqual([])
  })

  it('does not flag a command-substitution assignment', () => {
    expect(findEnvPrefixFindings('ci.sh', 'SHA=$(git rev-parse HEAD)')).toEqual([])
  })
})

// ─── env scrubbing ──────────────────────────────────────────────────────────

describe('scrubbedHookEnv', () => {
  it('keeps only the allowlisted keys the shell needs to run node/pnpm/nx', () => {
    const source = { PATH: '/usr/bin', HOME: '/Users/dev', SHELL: '/bin/zsh' }
    expect(scrubbedHookEnv(source)).toEqual(source)
  })

  it('drops everything not on the allowlist — the doctor\'s own ambient env leaks', () => {
    const source = {
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      TURBOPACK: '1',
      DATABASE_URL: 'postgres://localhost/dev',
      CI: '1',
      NODE_ENV: 'development',
    }
    expect(scrubbedHookEnv(source)).toEqual({ PATH: '/usr/bin' })
  })

  it('omits an allowlisted key entirely when the source never set it', () => {
    expect(scrubbedHookEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })
})

// ─── dynamic runner ─────────────────────────────────────────────────────────

describe('runGateTarget', () => {
  beforeEach(() => vi.clearAllMocks())

  it('special-cases format to the root prettier script, not nx affected', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false } as never)
    await runGateTarget('/repos/tastease', 'format')
    expect(execa).toHaveBeenCalledWith('pnpm', ['format'], expect.objectContaining({ cwd: '/repos/tastease' }))
  })

  it('runs every other target through nx affected against origin/main', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false } as never)
    await runGateTarget('/repos/tastease', 'build')
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['nx', 'affected', '-t', 'build', '--base=origin/main'],
      expect.objectContaining({ extendEnv: false, stdin: 'ignore' }),
    )
  })

  it('reports a passing target', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false } as never)
    const result = await runGateTarget('/repos/x', 'test')
    expect(result).toEqual({ target: 'test', passed: true, errorLine: undefined, timedOut: false })
  })

  it('extracts the first line mentioning an error for a failing target', async () => {
    vi.mocked(execa).mockResolvedValue({
      exitCode: 1,
      stdout: 'building...\n',
      stderr: 'ZodError: DATABASE_URL: expected string, received undefined\nmore noise\n',
      timedOut: false,
    } as never)
    const result = await runGateTarget('/repos/tastease', 'build')
    expect(result.passed).toBe(false)
    expect(result.errorLine).toBe('ZodError: DATABASE_URL: expected string, received undefined')
  })

  it('marks a hung target as failed and timed out, never passed', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: undefined, stdout: '', stderr: '', timedOut: true } as never)
    const result = await runGateTarget('/repos/x', 'test')
    expect(result).toEqual({ target: 'test', passed: false, errorLine: undefined, timedOut: true })
  })
})

// ─── report shape ───────────────────────────────────────────────────────────

describe('reportHasIssues', () => {
  it('is false for a clean project', () => {
    const report: ProjectGateReport = { repo: 'clean', staticFindings: [], targetResults: [{ target: 'test', passed: true, timedOut: false }] }
    expect(reportHasIssues([report])).toBe(false)
  })

  it('is true when the static layer found an env-prefix leak', () => {
    const report: ProjectGateReport = {
      repo: 'tastease',
      staticFindings: [{ file: 'ci.sh', line: 1, text: 'FOO=1 pnpm build', envVars: ['FOO'] }],
      targetResults: [],
    }
    expect(reportHasIssues([report])).toBe(true)
  })

  it('is true when a declared target failed', () => {
    const report: ProjectGateReport = {
      repo: 'diner-decider',
      staticFindings: [],
      targetResults: [{ target: 'test', passed: false, timedOut: false, errorLine: 'connection refused' }],
    }
    expect(reportHasIssues([report])).toBe(true)
  })

  it('is true when a project has a config issue even with no static findings or target results', () => {
    const report: ProjectGateReport = {
      repo: 'tastease',
      staticFindings: [],
      targetResults: [],
      configIssue: { kind: 'malformed-pre-push', message: 'ci.prePush is present but not a string array (got a string) — using default targets' },
    }
    expect(reportHasIssues([report])).toBe(true)
  })
})

describe('buildGateReport', () => {
  const project: GateProject = { repo: 'tastease', repoPath: '/repos/tastease', targets: ['lint', 'build'], ciScriptPath: null }

  beforeEach(() => vi.clearAllMocks())

  it('skips the dynamic layer entirely when not opted in', async () => {
    const report = await buildGateReport(project, false, 1000)
    expect(report.targetResults).toEqual([])
    expect(execa).not.toHaveBeenCalled()
  })

  it('runs every declared target per project, in order, when --dynamic is set', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false } as never)
    const report = await buildGateReport(project, true, 1000)
    expect(report.targetResults.map((r) => r.target)).toEqual(['lint', 'build'])
    expect(execa).toHaveBeenCalledTimes(2)
  })

  it('carries the project configIssue through to the report', async () => {
    const flagged: GateProject = { ...project, configIssue: { kind: 'unparseable-json', message: '.emit-infra.json failed to parse: Unexpected token' } }
    const report = await buildGateReport(flagged, false, 1000)
    expect(report.configIssue).toEqual(flagged.configIssue)
  })
})
