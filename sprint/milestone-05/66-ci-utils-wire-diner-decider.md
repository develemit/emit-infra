# Wire diner-decider CI and deploy scripts to ci-utils.sh
**Difficulty:** 3

## Goal

Replace diner-decider's hand-rolled `write_status` / `write_deploy_status` boilerplate with sourced calls to `emit-infra/scripts/lib/ci-utils.sh`, and annotate each meaningful step so the dashboard shows progress % during CI runs and deploys.

## Reason

Sprint 65 created the shared library. This sprint is the first project to adopt it — chosen first because diner-decider is the most complex (postgres spin-up in CI, blue-green deploy with a verify step), so proving the pattern on the hardest case validates it for the simpler projects in sprints 67–69.

## Context

**Depends on:** Sprint 65 (`emit-infra/scripts/lib/ci-utils.sh` must exist).

**`scripts/ci.sh` current steps** (in order):
1. `pnpm format` — format check
2. `pnpm nx run-many -t lint typecheck build` — lint · typecheck · build
3. `docker run ...` start CI postgres container
4. Wait loop until postgres is ready
5. `pnpm db:migrate && pnpm db:seed` — migrate + seed
6. `pnpm nx run-many -t test` — tests
7. `cleanup_db` — stop/remove postgres container

Steps 3+4 are one logical step ("Starting test database"). Step 7 is cleanup, not a user-visible step. So **5 CI steps** total.

**`scripts/deploy.sh` current steps** (in order):
1. GHCR login
2. `docker build` api image
3. `docker build` web image
4. `docker push` all images
5. `scp` env + compose files to server
6. `ssh` blue-green-deploy.sh on server
7. `ssh` verify (cat .deployed-version + curl health)

**7 deploy steps** total.

**Important details:**
- `CI_DB_CONTAINER` / `CI_DB_PORT` / `CI_DB_URL` are local vars defined near the top of `ci.sh` — keep them.
- The `cleanup_db` function is called both in the ERR trap and at the end of a successful run. The ERR trap should still call `cleanup_db` before `ci_done failure`.
- The ERR trap in each script should be updated to: `trap 'cleanup_db; ci_done failure; echo "✗ CI failed"; exit 1' ERR` (ci.sh) and `trap 'deploy_done failed; echo "✗ deploy failed"; exit 1' ERR` (deploy.sh).
- `SHA` and `BRANCH` are currently set at the top of each script — remove those lines after sourcing ci-utils (the library captures them internally via `_EMIT_SHA` / `_EMIT_BRANCH`). But the scripts may use `$SHA` elsewhere (e.g. deploy.sh line 98: `echo "✓ deployed $SHA"`). Keep a local `SHA=$(git rev-parse HEAD)` for that reference if needed, or use `$_EMIT_SHA`.
- Project root: `~/projects/diner-decider`
- Source path: `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"`

## Tasks

**ci.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after the `cd "$ROOT"` line.
2. Remove the hand-rolled `write_status()` function definition and the initial `running` printf.
3. Update the ERR trap to use `cleanup_db; ci_done failure`.
4. Add `ci_init 5` before the first step.
5. Add `ci_step "..."` before each of the 5 steps (see step labels below).
6. Replace the final `write_status success` with `ci_done success`.

CI step labels:
- `"Format"`
- `"Lint · typecheck · build"`
- `"Starting test database"`
- `"Migrate + seed"`
- `"Tests"`

**deploy.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after the `cd "$ROOT"` line.
2. Remove the hand-rolled `write_deploy_status()` function definition and the initial `deploying` printf.
3. Update the ERR trap to use `deploy_done failed`.
4. Add `deploy_init 7` before the first step.
5. Add `deploy_step "..."` before each of the 7 steps (see labels below).
6. Replace the final `write_deploy_status deployed` with `deploy_done deployed`.

Deploy step labels:
- `"GHCR auth"`
- `"Building api image"`
- `"Building web image"`
- `"Pushing images"`
- `"Copying files to server"`
- `"Blue-green deploy"`
- `"Verifying"`

## Files involved

- `~/projects/diner-decider/scripts/ci.sh` — replace boilerplate, add ci_init + ci_step calls
- `~/projects/diner-decider/scripts/deploy.sh` — replace boilerplate, add deploy_init + deploy_step calls

## Acceptance criteria

- [ ] `ci.sh` sources `emit-infra/scripts/lib/ci-utils.sh` and no longer defines `write_status()`.
- [ ] `deploy.sh` sources `emit-infra/scripts/lib/ci-utils.sh` and no longer defines `write_deploy_status()`.
- [ ] Dry-run `bash -n scripts/ci.sh` and `bash -n scripts/deploy.sh` both exit 0 (syntax clean).
- [ ] `.ci-status.json` after a step call contains `"progress":{"step":N,"total":5,...}`.
- [ ] `.deploy-status.json` after a step call contains `"progress":{"step":N,"total":7,...}`.
- [ ] ERR trap still calls `cleanup_db` before `ci_done failure` in ci.sh.
- [ ] Commit to diner-decider repo.

## Out of scope

- Running a full CI or deploy to verify end-to-end (requires docker + postgres locally).
- Dashboard changes.
- Other projects (sprints 67–69).

## Completed

**Date:** 2026-06-15

### Summary
Rewrote both scripts to source `emit-infra/scripts/lib/ci-utils.sh` and replaced all hand-rolled status boilerplate with library calls. `ci.sh` uses `ci_init 5` with steps: Format → Lint · typecheck · build → Starting test database → Migrate + seed → Tests. The ERR trap preserves the `cleanup_db` call before `ci_done failure`. `deploy.sh` uses `deploy_init 7` with steps: GHCR auth → Building api image → Building web image → Pushing images → Copying files to server → Blue-green deploy → Verifying. Local SHA var is kept in both scripts for use in the final echo and docker image tags.

### Files changed
- `~/projects/diner-decider/scripts/ci.sh` — sources ci-utils, 5 ci_step calls, cleanup_db preserved in trap
- `~/projects/diner-decider/scripts/deploy.sh` — sources ci-utils, 7 deploy_step calls

### Verification
- `bash -n scripts/ci.sh`: clean ✓
- `bash -n scripts/deploy.sh`: clean ✓
- Sources ci-utils.sh at correct position in both files ✓
- No `write_status` or `write_deploy_status` definitions remain ✓
- ERR trap: `cleanup_db; ci_done failure` in ci.sh ✓
- ci_step count: 5 ✓ / deploy_step count: 7 ✓
- Progress JSON shape (`"total":5` / `"total":7`): verified ✓
- Pre-commit hook: passed (prettier + nx checks) ✓
- Committed to diner-decider as `bbe264e`

### Follow-ups

- none
