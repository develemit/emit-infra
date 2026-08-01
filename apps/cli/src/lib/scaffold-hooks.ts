import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  readlinkSync,
  chmodSync,
} from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// __dirname varies with how this module is loaded: apps/cli/dist when run as
// the bundled CLI (esbuild flattens everything into one file there), but
// apps/cli/src/lib under vitest or any other unbundled invocation. A fixed
// relative offset silently broke every hook install once esbuild bundling
// landed (sprint 25) since nothing re-derived it. Walk up to the real
// scripts/hooks directory instead of guessing the depth.
function findHooksDir(startDir: string): string {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'scripts', 'hooks')
    if (existsSync(join(candidate, 'pre-push'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not locate scripts/hooks above ${startDir}`)
    }
    dir = parent
  }
}

const EMIT_INFRA_HOOKS_DIR = findHooksDir(__dirname)
const HOOK_NAMES = ['pre-commit', 'pre-push'] as const

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

export interface HookInstallResult {
  hook: string
  action: 'linked' | 'skipped' | 'replaced'
  path: string
}

function resolveHooksDir(cwd: string): { dir: string; husky: boolean } {
  const huskyDir = join(cwd, '.husky')
  if (existsSync(huskyDir)) return { dir: huskyDir, husky: true }
  return { dir: join(cwd, '.githooks'), husky: false }
}

function isOurLink(hookPath: string, sharedPath: string): boolean {
  try {
    return readlinkSync(hookPath) === sharedPath
  } catch {
    return false
  }
}

export function installHooks(cwd: string, force = false): {
  results: HookInstallResult[]
  husky: boolean
} {
  const { dir: rawDir, husky } = resolveHooksDir(cwd)
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true })
  // Resolve symlinked ancestors (e.g. macOS aliasing /tmp -> /private/tmp)
  // before computing relative paths below — otherwise the relative symlink
  // we write can point the wrong number of directories up from where the
  // hook file actually lives on disk.
  const dir = realpathSync(rawDir)

  const results: HookInstallResult[] = []

  for (const hook of HOOK_NAMES) {
    const hookPath = join(dir, hook)
    const sharedScript = join(EMIT_INFRA_HOOKS_DIR, hook)
    const relPath = relative(dir, sharedScript)

    if (pathExists(hookPath)) {
      if (isOurLink(hookPath, relPath) || isOurLink(hookPath, sharedScript)) {
        results.push({ hook, action: 'skipped', path: join(relative(cwd, dir), hook) })
        continue
      }
      if (!force) {
        results.push({ hook, action: 'skipped', path: join(relative(cwd, dir), hook) })
        continue
      }
      unlinkSync(hookPath)
    }

    symlinkSync(relPath, hookPath)
    chmodSync(hookPath, 0o755)
    results.push({ hook, action: force ? 'replaced' : 'linked', path: join(relative(cwd, dir), hook) })
  }

  return { results, husky }
}

export function uninstallHooks(cwd: string): string[] {
  const { dir: rawDir } = resolveHooksDir(cwd)
  const dir = existsSync(rawDir) ? realpathSync(rawDir) : rawDir
  const removed: string[] = []

  for (const hook of HOOK_NAMES) {
    const hookPath = join(dir, hook)
    if (!pathExists(hookPath)) continue
    const sharedScript = join(EMIT_INFRA_HOOKS_DIR, hook)
    const relPath = relative(dir, sharedScript)
    if (isOurLink(hookPath, relPath) || isOurLink(hookPath, sharedScript)) {
      unlinkSync(hookPath)
      removed.push(hook)
    }
  }

  return removed
}
