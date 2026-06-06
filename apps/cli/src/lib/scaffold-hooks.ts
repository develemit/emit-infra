import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectConfig } from '@emit-infra/core'

export type HookWriteResult =
  | { written: true; path: string; husky: boolean }
  | { written: false; path: string }

export function writePreCommitHook(cwd: string, config: ProjectConfig, force = false): HookWriteResult {
  const huskyDir = join(cwd, '.husky')

  if (existsSync(huskyDir)) {
    const hookPath = join(huskyDir, 'pre-commit')
    writeFileSync(hookPath, buildPreCommitHook(config))
    chmodSync(hookPath, 0o755)
    return { written: true, path: '.husky/pre-commit', husky: true }
  }

  const hooksDir = join(cwd, '.githooks')
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })
  const hookPath = join(hooksDir, 'pre-commit')

  if (existsSync(hookPath) && !force) {
    return { written: false, path: '.githooks/pre-commit' }
  }

  writeFileSync(hookPath, buildPreCommitHook(config))
  chmodSync(hookPath, 0o755)
  return { written: true, path: '.githooks/pre-commit', husky: false }
}

export function buildPreCommitHook(config: ProjectConfig): string {
  const tag = `${config.name}:pre-commit-check`
  return `#!/usr/bin/env bash
set -euo pipefail

echo "pre-commit: running checks on affected projects..."
pnpm nx affected -t check:all:e2e --base=HEAD

echo "pre-commit: verifying Docker build..."
TMPLOG=$(mktemp)
if ! docker build --build-arg BUILD_NUMBER=0 -t ${tag} . > "$TMPLOG" 2>&1; then
  cat "$TMPLOG"
  rm -f "$TMPLOG"
  echo "pre-commit: Docker build failed. Fix the above errors before committing."
  exit 1
fi
rm -f "$TMPLOG"
docker rmi ${tag} > /dev/null 2>&1 || true
echo "pre-commit: all checks passed."
`
}
