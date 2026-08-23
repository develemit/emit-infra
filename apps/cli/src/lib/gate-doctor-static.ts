import { existsSync, readFileSync } from 'node:fs'

export interface StaticFinding {
  file: string
  line: number
  text: string
  envVars: string[]
}

// One-or-more `VAR=value` tokens immediately followed by a command — the
// shape tastease's ci.sh had before commit 66f0c25:
// `SKIP_ENV_VALIDATION=1 pnpm nx affected -t build`. A bare assignment line
// with nothing after it (`FOO=1`) does not match — that's a real `export`-
// style default and not what this check is for.
//
// The value is deliberately restricted to a simple literal — no quotes, `$`,
// or parens. That's what separates tastease's bug (a hardcoded flag masking
// a failure the hook would hit) from ordinary shell plumbing that only looks
// similar: `ROOT="$(cd "$(dirname "$0")/.." && pwd)"` and diner-decider's
// `DATABASE_URL="$CI_DB_URL" pnpm nx run-many -t test` (self-computed from
// the container ci.sh itself started — legitimate, see sprint 298's Out of
// scope) both use quoted/computed values and correctly don't match.
const ENV_PREFIX_RE = /^((?:[A-Za-z_][A-Za-z0-9_]*=[^\s"'$()]+\s+)+)(\S.*)$/

/** Flags env vars prefixed directly onto a command in ci.sh. The hook's
 * `run_ci` sets no environment before running `pnpm nx affected -t <target>`,
 * so a var only the caller's shell supplies masks a failure the hook would
 * actually hit — this is the check that catches tastease's bug by
 * inspection, without running anything. */
export function findEnvPrefixFindings(scriptPath: string, content: string): StaticFinding[] {
  const findings: StaticFinding[] = []

  content.split('\n').forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return

    const match = line.match(ENV_PREFIX_RE)
    if (!match) return

    const prefix = (match[1] ?? '').trim()
    const envVars = prefix.split(/\s+/).map((assignment) => assignment.split('=')[0] ?? '')
    findings.push({ file: scriptPath, line: i + 1, text: line, envVars })
  })

  return findings
}

export function scanCiScriptForEnvPrefixes(scriptPath: string): StaticFinding[] {
  if (!existsSync(scriptPath)) return []
  return findEnvPrefixFindings(scriptPath, readFileSync(scriptPath, 'utf8'))
}
