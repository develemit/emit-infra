# Sprint 11 — CLI `emit versions` + Targeted Rollback

**Difficulty:** 3

## Goal

Add an `emit versions <project>` command that lists available build numbers,
and update `emit rollback` to accept an optional `--version <N>` flag for
rolling back to a specific build instead of just `:rollback`.

## Reason

The `:rollback` tag only keeps one previous version. With build-number tags
persisted in the registry (sprint 09), every past build is still pullable.
This sprint makes that history accessible from the CLI — you can see what
versions exist and target a specific one. This is the "undo button with a
dropdown" instead of just "undo once."

## Context

- `apps/cli/src/commands/rollback.ts` — existing rollback command. Reads
  config, SSHes to server, checks `:rollback` tags exist, swaps
  `:rollback` → `:latest`, restarts compose, health-checks. Registered in
  `apps/cli/src/index.ts` via `registerRollback(program)`.
- `apps/cli/src/commands/configure.ts` — example of a CLI command for
  reference on structure and conventions.
- `@emit-infra/core` exports `loadConfig` and `sshExec`.
- Config (`.emit-infra.json`) has `name`, `domain`, `serverIp`,
  `sshKeyName`, `deploy.appDir`, `deploy.composeDest`.
- Registry is `ghcr.io`. Images follow the pattern
  `ghcr.io/<owner>/<image-name>:<tag>`.
- Git tags in the project repo follow `build/<image-name>/<N>` (sprint 09).
- Build number tags on images: `ghcr.io/<owner>/<image>:<N>`.
- The compose file references images — need to read image names from it to
  know which images to query.

## Tasks

1. [x] Create `apps/cli/src/commands/versions.ts`:
   - Register `emit versions [name]` command
   - Load config, read the compose file's image names via SSH
     (`docker compose config --images`)
   - For each image, list available tags from ghcr.io using the OCI
     distribution API: `GET /v2/<name>/tags/list`
   - Filter to numeric tags, sort descending, display as a table
   - Mark the currently deployed version (read `.deployed-version` from
     server, per sprint 10) if available
   - Requires `GITHUB_TOKEN` env var for registry auth (or read from
     `gh auth token`)
2. [x] Register the new command in `apps/cli/src/index.ts`
3. [x] Update `apps/cli/src/commands/rollback.ts`:
   - Add `--version <N>` option
   - When `--version` is provided, skip the `:rollback` tag check
   - Instead: for each image, pull `<image>:<N>` from the registry on the
     server, tag it as `:latest`, then restart compose and health-check
   - When `--version` is NOT provided, keep existing `:rollback` behavior
4. [x] Typecheck the cli project

## Files involved

- new file: `apps/cli/src/commands/versions.ts` — list available builds
- `apps/cli/src/commands/rollback.ts` — add `--version` flag
- `apps/cli/src/index.ts` — register `versions` command

## Acceptance criteria

- [x] `emit versions <project>` lists available build numbers from the registry
- [x] Currently deployed version is marked in the output (if `.deployed-version` exists)
- [x] `emit rollback <project> --version 42` pulls build 42 and deploys it
- [x] `emit rollback <project>` (no flag) still works via `:rollback` tag swap
- [x] Typecheck clean

## Completed

**Date:** 2026-06-06

### Summary
Created `emit versions` command that queries the ghcr.io registry for numeric
build-number tags per image and displays them sorted descending, marking the
currently deployed version. Refactored `emit rollback` to support `--version <N>`
for targeted rollback — pulls the specific build from the registry, tags as
`:latest`, restarts compose, and health-checks. Extracted shared restart/health-check
logic into `restartAndHealthCheck` helper. The existing `:rollback` tag-swap
behavior is preserved when `--version` is not specified.

Registry auth follows the OCI token exchange pattern (www-authenticate → bearer
token) and falls back to `gh auth token` if `GITHUB_TOKEN` is not set.

### Files changed
- (new) `apps/cli/src/commands/versions.ts` — `emit versions` command with registry tag listing
- `apps/cli/src/commands/rollback.ts` — added `--version` option, refactored into `rollbackToVersion` / `rollbackToTag` / `restartAndHealthCheck`
- `apps/cli/src/index.ts` — registered `versions` command

### Verification
- Typecheck (cli): clean
- Code inspection: both code paths (tag-swap and version-pull) verified

### Follow-ups
none

## Out of scope

- Dashboard version display (sprint 12)
- Registry cleanup / pruning old tags (sprint 13)
- Rollback across multiple images with different build numbers (assumes all
  images in a project share the same build cadence for now)
