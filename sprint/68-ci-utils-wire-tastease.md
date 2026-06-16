# Wire tastease CI and deploy scripts to ci-utils.sh
**Difficulty:** 2

## Goal

Replace tastease's hand-rolled status-writing boilerplate with sourced calls to `emit-infra/scripts/lib/ci-utils.sh`, adding per-step progress tracking to both `ci.sh` and `deploy.sh`.

## Reason

Third of four project wiring sprints. Tastease is the simplest — 2-step CI (typecheck + build) and a 3-service build with single-compose deploy — so this sprint is low-risk and fast.

## Context

**Depends on:** Sprint 65 (`ci-utils.sh` exists).

**`scripts/ci.sh` current steps:**
1. `pnpm typecheck`
2. `SKIP_ENV_VALIDATION=1 pnpm build`

**2 CI steps** total.

**`scripts/deploy.sh` current steps:**
1. GHCR login
2. `docker build` api image (`ghcr.io/develemit/tastease/api`)
3. `docker build` web image (`ghcr.io/develemit/tastease/web`)
4. `docker build` marketing image (`ghcr.io/develemit/tastease/marketing`)
5. `docker push` all 3 images (loop over api/web/marketing, both :latest and :$BUILD_NUMBER tags)
6. `ssh` to server: docker login + cd + pull + up + write .deployed-version

**6 deploy steps** total.

**Important details:**
- `deploy.sh` has a `DEPLOY_HOST` guard check at the top — keep it, runs before `deploy_init`.
- The push loop iterates over `api web marketing` pushing both `:latest` and `:$BUILD_NUMBER` tags per image — that's all one logical "Pushing images" step; call `deploy_step` once before the loop.
- `BUILD_NUMBER=$(git rev-list --count HEAD)` is set before the build steps — keep it where it is.
- Project root: `~/projects/tastease`
- Source path: `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"`

## Tasks

**ci.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after `cd "$ROOT"`.
2. Remove `write_status()` definition and the initial `running` printf.
3. Update ERR trap: `trap 'ci_done failure; echo "✗ CI failed"; exit 1' ERR`.
4. Add `ci_init 2` before the first step.
5. Add `ci_step "Typecheck"` before `pnpm typecheck`.
6. Add `ci_step "Build"` before `pnpm build`.
7. Replace `write_status success` with `ci_done success`.

**deploy.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after `cd "$ROOT"`.
2. Remove `write_deploy_status()` definition and the initial `deploying` printf.
3. Update ERR trap: `trap 'deploy_done failed; echo "✗ deploy failed"; exit 1' ERR`.
4. Add `deploy_init 6` after the DEPLOY_HOST guard, before the GHCR login.
5. Add `deploy_step` calls before each of the 6 steps.
6. Replace `write_deploy_status deployed` with `deploy_done deployed`.

Deploy step labels:
- `"GHCR auth"`
- `"Building api image"`
- `"Building web image"`
- `"Building marketing image"`
- `"Pushing images"`
- `"Deploying on server"`

## Files involved

- `~/projects/tastease/scripts/ci.sh` — replace boilerplate, add step tracking
- `~/projects/tastease/scripts/deploy.sh` — replace boilerplate, add step tracking

## Acceptance criteria

- [x] `ci.sh` sources `ci-utils.sh` and no longer defines `write_status()`.
- [x] `deploy.sh` sources `ci-utils.sh` and no longer defines `write_deploy_status()`.
- [x] `bash -n scripts/ci.sh` and `bash -n scripts/deploy.sh` both exit 0.
- [x] `ci.sh` has exactly 2 `ci_step` calls; `deploy.sh` has exactly 6 `deploy_step` calls.
- [x] `DEPLOY_HOST` guard is preserved unchanged.
- [x] Commit to tastease repo.

## Completed

**Date:** 2026-06-15

### Summary
Rewrote both scripts to source `emit-infra/scripts/lib/ci-utils.sh` and replaced hand-rolled status boilerplate with library calls. `ci.sh` uses `ci_init 2` with steps: Typecheck → Build. `deploy.sh` uses `deploy_init 6` with steps: GHCR auth → Building api image → Building web image → Building marketing image → Pushing images → Deploying on server. The DEPLOY_HOST guard runs before `deploy_init` as pre-flight validation. Unlike develemail, tastease's GHCR scope check stays inside the "GHCR auth" step (after `deploy_init`) since the sprint spec only requires DEPLOY_HOST as pre-flight. Local `SHA` kept for final echo; `BRANCH` removed (only used in old boilerplate).

### Files changed
- `~/projects/tastease/scripts/ci.sh` — sources ci-utils, 2 ci_step calls
- `~/projects/tastease/scripts/deploy.sh` — sources ci-utils, 6 deploy_step calls, DEPLOY_HOST guard preserved

### Verification
- `bash -n scripts/ci.sh`: clean ✓
- `bash -n scripts/deploy.sh`: clean ✓
- No `write_status` or `write_deploy_status` definitions remain ✓
- ci_step count: 2 ✓ / deploy_step count: 6 ✓
- DEPLOY_HOST guard preserved before deploy_init ✓
- Pre-commit hook: passed ✓
- Committed to tastease as `269c87e`

### Follow-ups

- none

## Out of scope

- Running CI or deploy end-to-end.
- Dashboard changes.
- Other projects.
