import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const DEFAULT_CI_TARGETS = ['lint', 'typecheck', 'test', 'build']
const CONFIG_FILE = '.emit-infra.json'
const CI_SCRIPT = 'scripts/ci.sh'

export interface GateProject {
  repo: string
  repoPath: string
  targets: string[]
  ciScriptPath: string | null
}

interface RawConfig {
  ci?: { prePush?: unknown }
}

// Deliberately not the strict ProjectConfigSchema — the doctor only needs
// `ci.prePush` and must still scan repos whose config is otherwise
// incomplete (e.g. emit-billing has no `github.repo`-shaped deploy config).
// Falls back to the same default list scripts/hooks/pre-push's python reader
// uses, so an unset `ci.prePush` is checked the same way the hook checks it.
function readGateProject(repoPath: string): GateProject | null {
  const configPath = join(repoPath, CONFIG_FILE)
  if (!existsSync(configPath)) return null

  let raw: RawConfig
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as RawConfig
  } catch {
    return null
  }

  const declared = raw.ci?.prePush
  const targets =
    Array.isArray(declared) && declared.every((t) => typeof t === 'string')
      ? declared
      : DEFAULT_CI_TARGETS

  const ciScriptPath = join(repoPath, CI_SCRIPT)
  return {
    repo: basename(repoPath),
    repoPath,
    targets,
    ciScriptPath: existsSync(ciScriptPath) ? ciScriptPath : null,
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
