# Wire emit-vision CI and deploy scripts to ci-utils.sh
**Difficulty:** 3

## Goal

Replace emit-vision's hand-rolled status-writing boilerplate with sourced calls to `emit-infra/scripts/lib/ci-utils.sh`, adding per-step progress tracking to both `ci.sh` and `deploy.sh`.

## Reason

Last of the four project wiring sprints. emit-vision has the most complex deploy of the four: 4 images built with `docker buildx`, blue-green deploy, then separate Postgres and Clickhouse migration steps via remote SSH heredocs. These migrations are the highest-value steps to surface in the dashboard since they run after the container swap and can be the longest tail of a deploy.

## Context

**Depends on:** Sprint 65 (`ci-utils.sh` exists).

**`scripts/ci.sh` current steps:**
- `pnpm check:all` — single command, all checks bundled

**1 CI step** total. emit-vision wraps all checks in a single nx/pnpm command, so there's only one meaningful progress label. The step goes from 0% → 100% when check:all starts.

**`scripts/deploy.sh` current steps** (in order):
1. GHCR auth (`gh auth token | docker login`)
2. `docker buildx build` api image (linux/amd64, --push)
3. `docker buildx build` worker image (linux/amd64, --push)
4. `docker buildx build` web image (linux/amd64, --push)
5. `docker buildx build` marketing image (linux/amd64, --push)
6. `scp` compose files + scripts to server
7. SSH: update server .env (upsert IMAGE_TAG, BUILD_NUMBER, GHCR_ORG via heredoc)
8. SSH: blue-green deploy (`blue-green-deploy.sh emit-vision`)
9. SSH: Postgres migrations (`docker compose exec api node packages/db/src/migrate.cjs`)
10. SSH: Clickhouse migrations (`docker compose exec api node packages/clickhouse/src/migrate.cjs`)

**10 deploy steps** total. Note: emit-vision uses `docker buildx build --push` (builds and pushes in one command), so there is no separate push step — the push is folded into each build step.

**Important details:**
- `deploy.sh` sources `infra/secrets.prod.env` (not `.env.prod`) — keep this line unchanged.
- `SHA` and `BUILD_NUMBER` are used throughout the file in SSH commands and the final echo — keep a local reference or use `$_EMIT_SHA`. Simplest: keep `SHA=$(git rev-parse HEAD)` and `BUILD_NUMBER=$(git rev-list --count HEAD)` as local vars alongside the sourced library.
- The SSH migration steps use bash heredocs (`ssh ... bash << REMOTE ... REMOTE`) — these are complex multi-line blocks. The `deploy_step` call goes on the line *before* the `ssh` command that opens the heredoc.
- `ci.sh` currently has no `set -e` (uses `set -uo pipefail` + implicit trap) — the ERR trap is the primary error catcher; keep this consistent.
- Project root: `~/projects/emit-vision`
- Source path: `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"`
- SSH key: `~/.ssh/emit-vision-deploy` (not `~/.ssh/emit-deploy`)

## Tasks

**ci.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after `cd "$ROOT"`.
2. Remove `write_status()` definition and the initial `running` printf.
3. Update ERR trap: `trap 'ci_done failure; echo "✗ CI failed"; exit 1' ERR`.
4. Add `ci_init 1` before the step.
5. Add `ci_step "Running checks"` before `pnpm check:all`.
6. Replace `write_status success` with `ci_done success`.

**deploy.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after the `source infra/secrets.prod.env` line.
2. Keep `SHA=$(git rev-parse HEAD)` and `BUILD_NUMBER=$(git rev-list --count HEAD)` as local vars (used in SSH commands and the final echo).
3. Remove `write_deploy_status()` definition and the initial `deploying` printf.
4. Update ERR trap: `trap 'deploy_done failed; echo "✗ deploy failed"; exit 1' ERR`.
5. Add `deploy_init 10` before the GHCR auth step.
6. Add `deploy_step` before each of the 10 steps.
7. Replace `write_deploy_status deployed` with `deploy_done deployed`.

Deploy step labels:
- `"GHCR auth"`
- `"Building api image"`
- `"Building worker image"`
- `"Building web image"`
- `"Building marketing image"`
- `"Copying files to server"`
- `"Updating server env"`
- `"Blue-green deploy"`
- `"Postgres migrations"`
- `"Clickhouse migrations"`

## Files involved

- `~/projects/emit-vision/scripts/ci.sh` — replace boilerplate, add step tracking
- `~/projects/emit-vision/scripts/deploy.sh` — replace boilerplate, add step tracking

## Acceptance criteria

- [x] `ci.sh` sources `ci-utils.sh` and no longer defines `write_status()`.
- [x] `deploy.sh` sources `ci-utils.sh` and no longer defines `write_deploy_status()`.
- [x] `bash -n scripts/ci.sh` and `bash -n scripts/deploy.sh` both exit 0.
- [x] `ci.sh` has exactly 1 `ci_step` call; `deploy.sh` has exactly 10 `deploy_step` calls.
- [x] `source infra/secrets.prod.env` is still the first source line (before `ci-utils.sh`).
- [x] Local `SHA` and `BUILD_NUMBER` vars are preserved for use in SSH heredocs.
- [x] Commit to emit-vision repo.

## Completed

**Date:** 2026-06-15

### Summary
Rewrote both scripts to source `emit-infra/scripts/lib/ci-utils.sh` and replaced hand-rolled status boilerplate with library calls. `ci.sh` uses `ci_init 1` with a single step: "Running checks" (emit-vision wraps all checks in one `pnpm check:all` command). `deploy.sh` uses `deploy_init 10` with all 10 steps. The key complexity was the migrations: the original script had both Postgres and Clickhouse migrations in a single SSH heredoc. To give each migration its own `deploy_step`, they were split into two separate SSH heredoc calls — each independently sources `.env` and reads `.active-slot`, preserving identical behavior with individual progress tracking. `source infra/secrets.prod.env` remains the first source line; `ci-utils.sh` is sourced immediately after. Local `SHA` and `BUILD_NUMBER` are kept for use in SSH commands and the final echo.

### Files changed
- `~/projects/emit-vision/scripts/ci.sh` — sources ci-utils, 1 ci_step call
- `~/projects/emit-vision/scripts/deploy.sh` — sources ci-utils, 10 deploy_step calls; migrations split into 2 SSH heredocs

### Verification
- `bash -n scripts/ci.sh`: clean ✓
- `bash -n scripts/deploy.sh`: clean ✓
- No `write_status` or `write_deploy_status` definitions remain ✓
- ci_step count: 1 ✓ / deploy_step count: 10 ✓
- `source infra/secrets.prod.env` first (line 11), ci-utils.sh second (line 13) ✓
- SHA and BUILD_NUMBER preserved as local vars ✓
- Pre-commit hook: passed ✓
- Committed to emit-vision as `b52e7fb`

### Follow-ups

- none

## Out of scope

- Running CI or deploy end-to-end.
- Dashboard changes.
- Other projects.
