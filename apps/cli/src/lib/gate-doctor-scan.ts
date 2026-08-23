import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const DEFAULT_CI_TARGETS = ['lint', 'typecheck', 'test', 'build']
const CONFIG_FILE = '.emit-infra.json'
const CI_SCRIPT = 'scripts/ci.sh'

export interface ConfigIssue {
  kind: 'unparseable-json' | 'malformed-pre-push'
  message: string
}

export interface GateProject {
  repo: string
  repoPath: string
  targets: string[]
  ciScriptPath: string | null
  configIssue?: ConfigIssue
}

interface RawConfig {
  ci?: { prePush?: unknown }
}

function describeShape(value: unknown): string {
  if (typeof value === 'string') return 'a string'
  if (Array.isArray(value)) return 'an array with non-string entries'
  if (value !== null && typeof value === 'object') return 'an object'
  return typeof value
}

// Deliberately not the strict ProjectConfigSchema — the doctor only needs
// `ci.prePush` and must still scan repos whose config is otherwise
// incomplete (e.g. emit-billing has no `github.repo`-shaped deploy config).
// Falls back to the same default list scripts/hooks/pre-push's python reader
// uses, so an *unset* `ci.prePush` is checked the same way the hook checks
// it — that fallback is silent by design. A *present but malformed*
// ci.prePush is a different case: the hook's python reader doesn't fall back
// the same way (see load_pre_push_config in pre-push-config.sh, which feeds
// the raw value straight into `' '.join(...)`), so silently substituting
// defaults here would report "clean" while checking a target list the
// project never declared. That case — and an unparseable config file
// entirely — must be reported, not swallowed.
function readGateProject(repoPath: string): GateProject | null {
  const configPath = join(repoPath, CONFIG_FILE)
  if (!existsSync(configPath)) return null

  const repo = basename(repoPath)
  const ciScriptPath = join(repoPath, CI_SCRIPT)
  const resolvedCiScriptPath = existsSync(ciScriptPath) ? ciScriptPath : null

  let raw: RawConfig
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as RawConfig
  } catch (err) {
    return {
      repo,
      repoPath,
      targets: DEFAULT_CI_TARGETS,
      ciScriptPath: resolvedCiScriptPath,
      configIssue: {
        kind: 'unparseable-json',
        message: `${CONFIG_FILE} failed to parse: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }

  const declared = raw.ci?.prePush
  const isValidTargets = Array.isArray(declared) && declared.every((t) => typeof t === 'string')
  const configIssue: ConfigIssue | undefined =
    declared !== undefined && !isValidTargets
      ? {
          kind: 'malformed-pre-push',
          message: `ci.prePush is present but not a string array (got ${describeShape(declared)}) — using default targets`,
        }
      : undefined

  return {
    repo,
    repoPath,
    targets: isValidTargets ? (declared as string[]) : DEFAULT_CI_TARGETS,
    ciScriptPath: resolvedCiScriptPath,
    ...(configIssue ? { configIssue } : {}),
  }
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

/** Scans one level of `rootsDir` for repos with a `.emit-infra.json`. */
export function scanGateFleet(rootsDir: string): GateProject[] {
  let entries
  try {
    entries = readdirSync(rootsDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => readGateProject(join(rootsDir, e.name)))
    .filter((p): p is GateProject => p !== null)
}

export function findGateProject(rootsDir: string, name: string): GateProject | null {
  return readGateProject(join(rootsDir, name))
}
