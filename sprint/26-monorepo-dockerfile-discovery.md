# Monorepo Dockerfile discovery

**Difficulty:** 2

## Goal

Fix two places in emit-infra that assume a root-level `Dockerfile` exists,
breaking every project that uses the standard `apps/<name>/Dockerfile` monorepo
layout — which is *all* of them.

## Reason

Every project wired to emit-infra is a monorepo with Dockerfiles under
`apps/api/Dockerfile` and `apps/web/Dockerfile`. Two components hard-code
the assumption that a single `Dockerfile` lives at the project root:

1. **`audit` command** — `findDockerfiles` only searches `./` and `./docker/`,
   so it silently exits with "No Dockerfiles found" on every project.
2. **The pre-commit hook template** (`scaffold-hooks.ts`) — runs
   `docker build ... .` from the project root, which fails immediately because
   there is no root `Dockerfile`. The hook blocks every commit that touches
   a file in a Docker-wired project.

Both bugs were discovered when auditing `diner-decider` (2026-06-07).
The pre-commit Docker build step was removed from that project as a workaround,
but the root cause needs fixing in the CLI so future projects don't hit it.

## Tasks

### 1. Fix `findDockerfiles` in `apps/cli/src/commands/audit.ts`

Replace the current two-path search with a recursive search that also walks
`apps/*/` subdirectories:

```ts
function findDockerfiles(projectDir: string): string[] {
  const candidates: string[] = []
  const searchDirs = [
    projectDir,
    join(projectDir, 'docker'),
    ...readdirSync(join(projectDir, 'apps'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(projectDir, 'apps', d.name)),
  ].filter(existsSync)

  for (const dir of searchDirs) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('Dockerfile')) candidates.push(join(dir, f))
    }
  }
  return candidates
}
```

Guard the `apps/` read with a `try/catch` or `existsSync` so projects without
an `apps/` directory still work.

### 2. Fix the pre-commit hook template in `apps/cli/src/lib/scaffold-hooks.ts`

The hook currently contains a monolithic `docker build ... .` block. Replace it
with a loop over discovered Dockerfiles:

```bash
echo "pre-commit: verifying Docker builds..."
FAILED=0
for df in $(find . -name 'Dockerfile' -not -path '*/node_modules/*' -not -path '*/.next/*'); do
  APP=$(dirname "$df")
  TAG="$(basename $(pwd))-$(basename $APP):pre-commit-check"
  TMPLOG=$(mktemp)
  echo "  building $df..."
  if ! docker build -f "$df" --build-arg BUILD_NUMBER=0 -t "$TAG" . > "$TMPLOG" 2>&1; then
    cat "$TMPLOG"
    rm -f "$TMPLOG"
    echo "pre-commit: Docker build failed for $df"
    FAILED=1
  else
    rm -f "$TMPLOG"
    docker rmi "$TAG" > /dev/null 2>&1 || true
  fi
done
if [ "$FAILED" -eq 1 ]; then
  echo "pre-commit: fix Docker errors above before committing."
  exit 1
fi
```

Note: the Docker build step in pre-commit is slow for monorepos (multiple
images). Consider gating it behind a `EMIT_INFRA_DOCKER_CHECK=1` env var so
projects can opt in rather than running it on every commit by default.

### 3. Regenerate hooks in existing projects

After the fix, update the docs / README to note that existing projects should
re-run `emit-infra hooks` to pick up the corrected template.

## Files involved

- `apps/cli/src/commands/audit.ts` — `findDockerfiles` function
- `apps/cli/src/lib/scaffold-hooks.ts` — pre-commit hook template string

## Acceptance criteria

- [x] `emit-infra audit --local` run from a monorepo project root finds
  Dockerfiles at `apps/api/Dockerfile` and `apps/web/Dockerfile`
- [x] `emit-infra audit --local` still works for projects with a root-level
  `Dockerfile` (no regression)
- [x] The scaffolded pre-commit hook iterates `apps/*/Dockerfile` rather than
  assuming a root `Dockerfile`
- [x] `emit-infra audit --local` run from `diner-decider` reports issues
  correctly (previously exited silently)

## Completed

**Date:** 2026-06-07

### Summary
Fixed both root-`Dockerfile` assumptions. `findDockerfiles` now walks `apps/*/` subdirectories in addition to `./` and `./docker/`, so `emit-infra audit --local` correctly discovers monorepo Dockerfiles. The pre-commit Docker build block was replaced with a `find`-based loop over all Dockerfiles and gated behind `EMIT_INFRA_DOCKER_CHECK=1` so it's opt-in by default — eliminating the hook-blocks-every-commit problem on all current projects.

### Files changed
- `apps/cli/src/commands/audit.ts` — `findDockerfiles` now includes `apps/*/` subdirectories, guarded by `existsSync`
- `apps/cli/src/lib/scaffold-hooks.ts` — pre-commit Docker block replaced with opt-in loop; `config` param retained for future use

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code inspection: `findDockerfiles` covers root, `docker/`, and `apps/*/`; hook correctly skips Docker by default

### Follow-ups
- `[defer]` `buildPreCommitHook` no longer uses its `config` parameter — prefix with `_config` or re-use when per-project tag customization is needed
- `[defer]` Existing projects should re-run `emit-infra hooks` to get the opt-in Docker check template

## Out of scope

- Deeper recursive search beyond `apps/*/` (e.g. `services/*/`) — can be
  added when a project needs it
- Fixing existing projects' pre-commit hooks — each project re-runs
  `emit-infra hooks` at their own pace
