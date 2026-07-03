import { existsSync, mkdirSync, symlinkSync, unlinkSync, readlinkSync, chmodSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const EMIT_INFRA_HOOKS_DIR = resolve(__dirname, '../../../../scripts/hooks')
const HOOK_NAMES = ['pre-commit', 'pre-push'] as const

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
  const { dir, husky } = resolveHooksDir(cwd)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const results: HookInstallResult[] = []

  for (const hook of HOOK_NAMES) {
    const hookPath = join(dir, hook)
    const sharedScript = join(EMIT_INFRA_HOOKS_DIR, hook)
    const relPath = relative(dir, sharedScript)

    if (existsSync(hookPath)) {
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
  const { dir } = resolveHooksDir(cwd)
  const removed: string[] = []

  for (const hook of HOOK_NAMES) {
    const hookPath = join(dir, hook)
    if (!existsSync(hookPath)) continue
    const sharedScript = join(EMIT_INFRA_HOOKS_DIR, hook)
    const relPath = relative(dir, sharedScript)
    if (isOurLink(hookPath, relPath) || isOurLink(hookPath, sharedScript)) {
      unlinkSync(hookPath)
      removed.push(hook)
    }
  }

  return removed
}
