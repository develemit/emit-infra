import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync, existsSync, lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { installHooks, uninstallHooks } from './scaffold-hooks.js'

describe('scaffold-hooks', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scaffold-hooks-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('symlinks resolve to the real shared hook scripts, regardless of module load depth', () => {
    // Regression: the hooks dir used to be derived from a hardcoded relative
    // offset from this module's own location, which broke as soon as the
    // bundled CLI's directory depth diverged from the unbundled source tree
    // (sprint 25's esbuild migration did exactly that, silently).
    const { results } = installHooks(dir)
    expect(results.every((r) => r.action === 'linked')).toBe(true)

    for (const hook of ['pre-commit', 'pre-push']) {
      const linkPath = join(dir, '.githooks', hook)
      expect(existsSync(linkPath)).toBe(true)
      expect(realpathSync(linkPath)).toBe(realpathSync(join(process.cwd(), 'scripts', 'hooks', hook)))
    }
  })

  it('uses .husky when present instead of .githooks', () => {
    mkdirSync(join(dir, '.husky'))
    const { husky } = installHooks(dir)
    expect(husky).toBe(true)
    expect(existsSync(join(dir, '.husky', 'pre-push'))).toBe(true)
  })

  it('skips a dangling foreign symlink without --force instead of crashing', () => {
    const githooks = join(dir, '.githooks')
    mkdirSync(githooks)
    symlinkSync('../../nonexistent/pre-commit', join(githooks, 'pre-commit'))

    const { results } = installHooks(dir)
    const preCommit = results.find((r) => r.hook === 'pre-commit')
    expect(preCommit?.action).toBe('skipped')
  })

  it('replaces a dangling foreign symlink with --force', () => {
    const githooks = join(dir, '.githooks')
    mkdirSync(githooks)
    symlinkSync('../../nonexistent/pre-commit', join(githooks, 'pre-commit'))

    const { results } = installHooks(dir, true)
    const preCommit = results.find((r) => r.hook === 'pre-commit')
    expect(preCommit?.action).toBe('replaced')
    expect(realpathSync(join(githooks, 'pre-commit'))).toBe(
      realpathSync(join(process.cwd(), 'scripts', 'hooks', 'pre-commit')),
    )
  })

  it('re-running install is a no-op (skipped) on our own links', () => {
    installHooks(dir)
    const { results } = installHooks(dir)
    expect(results.every((r) => r.action === 'skipped')).toBe(true)
  })

  it('uninstallHooks removes only our own symlinks', () => {
    installHooks(dir)
    const removed = uninstallHooks(dir)
    expect(removed.sort()).toEqual(['pre-commit', 'pre-push'])
    expect(existsSync(join(dir, '.githooks', 'pre-commit'))).toBe(false)
  })

  it('uninstallHooks leaves a foreign hook untouched', () => {
    const githooks = join(dir, '.githooks')
    mkdirSync(githooks)
    symlinkSync('../../nonexistent/pre-commit', join(githooks, 'pre-commit'))

    const removed = uninstallHooks(dir)
    expect(removed).toEqual([])
    expect(() => lstatSync(join(githooks, 'pre-commit'))).not.toThrow()
  })
})
