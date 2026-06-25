# Wire develemail CI and deploy scripts to ci-utils.sh
**Difficulty:** 2

## Goal

Replace develemail's hand-rolled status-writing boilerplate with sourced calls to `emit-infra/scripts/lib/ci-utils.sh`, adding per-step progress tracking to both `ci.sh` and `deploy.sh`.

## Reason

Sprint 66 proved the pattern on diner-decider. Develemail is the second project: 3-service build (web/api/worker) with opendkim/postfix config copying in the deploy, slightly different from diner-decider's blue-green but same library interface.

## Context

**Depends on:** Sprint 65 (`ci-utils.sh` exists), Sprint 66 (pattern validated).

**`scripts/ci.sh` current steps:**
1. `pnpm nx format:check --base="remotes/origin/main"` — format check
2. `pnpm nx run-many -t lint test build typecheck` — lint · test · build · typecheck

**2 CI steps** total. Note: before step 1, there's `git checkout -- apps/web/next-env.d.ts || true` to restore a file that next build corrupts — keep this line, it's not a step, just a pre-flight fix.

**`scripts/deploy.sh` current steps:**
1. GHCR login (`echo "$TOKEN" | docker login ...`)
2. `docker build` web image
3. `docker build` api image
4. `docker build` worker image
5. `docker push` web + api + worker (loop)
6. `scp` docker-compose.prod.yml + opendkim + postfix configs to server
7. `ssh` write .env to server
8. `ssh` pull + up + prune on server

**8 deploy steps** total.

**Important details:**
- `deploy.sh` has a GHCR scope check (`gh api /user -i | grep -qi "write:packages"`) before the login — keep it, it runs before `deploy_init`.
- `SERVER_IP` guard check near the top of deploy.sh — keep it, runs before `deploy_init`.
- The `for SERVICE in web api worker` loop in deploy.sh covers 3 separate build commands — each gets its own `deploy_step` call (step 2, 3, 4), so the loop becomes three explicit calls or the loop body calls `deploy_step`.
- Similarly the push loop can stay as a loop; just call `deploy_step "Pushing images"` once before it starts.
- Project root: `~/projects/develemail`
- Source path: `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"`

## Tasks

**ci.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after `cd "$ROOT"`.
2. Remove `write_status()` definition and the initial `running` printf.
3. Update ERR trap: `trap 'ci_done failure; echo "✗ CI failed"; exit 1' ERR`.
4. Add `ci_init 2` before the pre-flight `git checkout` line.
5. Add `ci_step "Format check"` before the format check command.
6. Add `ci_step "Lint · test · build · typecheck"` before `pnpm nx run-many`.
7. Replace `write_status success` with `ci_done success`.

**deploy.sh:**
1. Add `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"` after `cd "$ROOT"`.
2. Remove `write_deploy_status()` definition and the initial `deploying` printf.
3. Update ERR trap: `trap 'deploy_done failed; echo "✗ deploy failed"; exit 1' ERR`.
4. Add `deploy_init 8` after the pre-flight checks (SERVER_IP guard + GHCR scope check), before the GHCR login.
5. Add `deploy_step` calls before each of the 8 steps.
6. Replace `write_deploy_status deployed` with `deploy_done deployed`.

Deploy step labels:
- `"GHCR auth"`
- `"Building web image"`
- `"Building api image"`
- `"Building worker image"`
- `"Pushing images"`
- `"Copying config to server"`
- `"Writing env to server"`
- `"Deploying on server"`

## Files involved

- `~/projects/develemail/scripts/ci.sh` — replace boilerplate, add step tracking
- `~/projects/develemail/scripts/deploy.sh` — replace boilerplate, add step tracking

## Acceptance criteria

- [x] `ci.sh` sources `ci-utils.sh` and no longer defines `write_status()`.
- [x] `deploy.sh` sources `ci-utils.sh` and no longer defines `write_deploy_status()`.
- [x] `bash -n scripts/ci.sh` and `bash -n scripts/deploy.sh` both exit 0.
- [x] `ci.sh` has exactly 2 `ci_step` calls; `deploy.sh` has exactly 8 `deploy_step` calls.
- [x] The GHCR scope check and `git checkout -- apps/web/next-env.d.ts` pre-flight lines are preserved unchanged.
- [x] Commit to develemail repo.

## Completed

**Date:** 2026-06-15

### Summary
Rewrote both scripts to source `emit-infra/scripts/lib/ci-utils.sh` and replaced all hand-rolled status boilerplate with library calls. `ci.sh` uses `ci_init 2` with steps: Format check → Lint · test · build · typecheck. The `git checkout -- apps/web/next-env.d.ts` pre-flight line is preserved between `ci_init` and the first `ci_step`. `deploy.sh` uses `deploy_init 8` with steps: GHCR auth → Building web image → Building api image → Building worker image (via loop) → Pushing images → Copying config to server → Writing env to server → Deploying on server. The SERVER_IP guard and GHCR scope check are preserved as pre-flight validation before `deploy_init`. Local `SHA` kept in both scripts for docker image tags and final echo.

### Files changed
- `~/projects/develemail/scripts/ci.sh` — sources ci-utils, 2 ci_step calls, pre-flight git checkout preserved
- `~/projects/develemail/scripts/deploy.sh` — sources ci-utils, 8 deploy_step calls (3 via loop), SERVER_IP + GHCR scope checks preserved before deploy_init

### Verification
- `bash -n scripts/ci.sh`: clean ✓
- `bash -n scripts/deploy.sh`: clean ✓
- No `write_status` or `write_deploy_status` definitions remain ✓
- ci_step count: 2 ✓ / deploy_step runtime calls: 8 (1 GHCR + 3 builds + 1 push + 1 copy + 1 env + 1 deploy) ✓
- `git checkout -- apps/web/next-env.d.ts` line preserved ✓
- GHCR scope check preserved before deploy_init ✓
- Pre-commit hook: passed ✓
- Committed to develemail as `44cba05`

### Follow-ups

- none

## Out of scope

- Running CI or deploy end-to-end.
- Dashboard changes.
- Other projects.
