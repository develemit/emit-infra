import type { ProjectConfig } from '@emit-infra/core'

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
