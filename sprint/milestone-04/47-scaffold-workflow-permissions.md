# Sprint 47 — Scaffold Workflow: Add permissions: contents: write

> _Promoted from sprint-09 backlog item, 2026-06-12._

## Goal

Add an explicit `permissions: contents: write` block to the GitHub Actions
workflow scaffolded by `emit-infra init` so the git tag push step works in
repos that restrict default workflow permissions.

## Context

`apps/cli/src/commands/init.ts` — `buildWorkflow()` generates a YAML string
for `.github/workflows/build.yml`. It includes a step that pushes a Docker
image and (in some project configs) a git tag. In repositories where the
GitHub Actions default permissions are set to read-only (common in orgs that
enforce least-privilege), the tag push step silently fails with a 403 unless
`permissions: contents: write` is declared.

Sprint 41 already added a `BUILD_NUMBER` comment block in this function. The
pattern for adding to the scaffolded YAML is established.

The `permissions` key should be added at the **job level** (not top-level
workflow) so that it's scoped minimally:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # required for git tag push
      packages: write      # required for GHCR push
```

`packages: write` is already implied by the GHCR login step but should be
explicit alongside `contents: write` for clarity.

## Tasks

1. Read `apps/cli/src/commands/init.ts` — find `buildWorkflow()` and note the
   exact indentation and structure of the `jobs:` / `build:` block.
2. Insert a `permissions:` block immediately after the `runs-on:` line
   (before the `steps:` key), with:
   ```yaml
       permissions:
         contents: write   # required for git tag push
         packages: write   # required for GHCR push
   ```
3. Confirm the YAML indentation is consistent with the rest of the template
   (2-space indent, 4-space for job-level keys).
4. Run `pnpm nx run cli:typecheck` — confirm clean.

## Acceptance criteria

- [x] Scaffolded workflow includes `permissions: contents: write` and
      `permissions: packages: write` under the `build:` job
- [x] YAML indentation is consistent with the rest of the template
- [x] `pnpm nx run cli:typecheck` clean

## Completed

**Date:** 2026-06-12

### Summary
The `buildWorkflow()` scaffold in `init.ts` already had a `permissions:` block — but it used `contents: read`, which would silently fail any git tag push step in orgs with restricted default permissions. Changed `contents: read` to `contents: write` and added inline comments (`# required for git tag push` / `# required for GHCR push`) to both permission keys. The job is named `deploy:` in the actual scaffold (not `build:` as the sprint spec said — minor discrepancy in the spec, no functional difference).

### Files changed
- `apps/cli/src/commands/init.ts` — changed `contents: read` → `contents: write`, added explanatory comments to both permission keys in `buildWorkflow()`

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code review: `permissions.contents` is now `write`; indentation matches surrounding 4-space job-level keys; `packages: write` comment added

### Follow-ups
none
