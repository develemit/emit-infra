# Create emit-infra/scripts/lib/ci-utils.sh shared shell utility library
**Difficulty:** 2

## Goal

Create a single sourced shell library at `emit-infra/scripts/lib/ci-utils.sh` that owns all CI and deploy status-writing logic — progress tracking, ERR trap helpers, and final status writes — so every project can source it instead of maintaining its own copy.

## Reason

All four active projects (diner-decider, develemail, tastease, emit-vision) each hand-roll the same `write_status` / `write_deploy_status` functions, the same `trap` patterns, and the same `running` / `deploying` writes. Progress tracking (writing `progress.pct` to the status JSON so the dashboard can show "deploying · 37%") needs to be added to all 8 scripts. Without a shared library, that's 8 separate edits now and every future change to the status format is another 8-way touch. This sprint creates the foundation; sprints 66–69 wire each project to it.

## Context

- Status files written by CI scripts: `<project-root>/.ci-status.json`
- Status files written by deploy scripts: `<project-root>/.deploy-status.json`
- Current shape (no progress): `{"status":"running","sha":"...","branch":"...","startedAt":"..."}`
- Target shape (with progress): adds `"progress":{"step":N,"total":N,"pct":N,"label":"..."}`
- `progress` is omitted from the final `success`/`failure`/`deployed`/`failed` write — only present while in-flight
- Library is sourced, not executed: must not use `#!/usr/bin/env bash` shebang behavior that would break sourcing; internal variables are prefixed `_EMIT_` to avoid colliding with the sourcing script's own vars
- Projects source it with: `source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"`
- The `scripts/lib/` directory does not yet exist — create it

## Tasks

1. Create `scripts/lib/ci-utils.sh` with the following functions:

   **CI helpers** (write to `.ci-status.json`):
   - `ci_init <total_steps>` — captures SHA, BRANCH, STARTED_AT; sets `_EMIT_CI_TOTAL`; writes initial `{"status":"running","sha":"...","branch":"...","startedAt":"...","progress":{"step":0,"total":N,"pct":0,"label":"starting"}}`
   - `ci_step "<label>"` — increments `_EMIT_CI_STEP`, computes `pct = step * 100 / total`, rewrites `.ci-status.json` with updated progress
   - `ci_done <status>` — writes final `{"status":"<status>","sha":"...","branch":"...","completedAt":"..."}` (no `progress` field)

   **Deploy helpers** (write to `.deploy-status.json`):
   - `deploy_init <total_steps>` — same as `ci_init` but targets `.deploy-status.json` and uses `"status":"deploying"`
   - `deploy_step "<label>"` — same as `ci_step` but targets `.deploy-status.json`
   - `deploy_done <status>` — writes final deploy status (no `progress` field)

2. Use `printf` (not `echo`) for all JSON writes — consistent with existing scripts.
3. Use integer arithmetic only (`$(( ))`) — no `bc`, no `awk`.
4. The library must be safely sourceable multiple times (use a guard variable `_EMIT_CI_UTILS_LOADED`).

## Files involved

- (new) `scripts/lib/ci-utils.sh` — the shared library

## Acceptance criteria

- [ ] `scripts/lib/ci-utils.sh` exists and is readable (not executable — it's sourced, not run).
- [ ] Sourcing it in a test script and calling `ci_init 4 && ci_step "step one" && ci_done success` produces valid JSON in `.ci-status.json` with `"status":"running"` after `ci_step` and `"status":"success"` (no `progress` field) after `ci_done`.
- [ ] `deploy_init / deploy_step / deploy_done` produce analogous output in `.deploy-status.json`.
- [ ] Double-sourcing the file does not error or reset in-flight state.
- [ ] No external dependencies (no `jq`, `python3`, `node` — only bash builtins and `date`).

## Out of scope

- Wiring any project to the library (sprints 66–69).
- Dashboard changes.
- Updating `ci-mode.sh` to read the `progress` field (backlog item).

## Completed

**Date:** 2026-06-15

### Summary
Created `scripts/lib/ci-utils.sh` with six functions: `ci_init/ci_step/ci_done` (writing to `.ci-status.json`) and `deploy_init/deploy_step/deploy_done` (writing to `.deploy-status.json`). The library uses a `_EMIT_CI_UTILS_LOADED` guard so double-sourcing is safe and doesn't reset in-flight step counters. All internal state uses `_EMIT_` prefixed variables. JSON is written with `printf` only, integer arithmetic for `pct`, no external dependencies.

### Files changed
- (new) `scripts/lib/ci-utils.sh` — shared CI/deploy status helpers; sourced by all project scripts

### Verification
- Live bash test: `ci_init 4 → ci_step → ci_done success` produces correct JSON at each stage; `progress` absent from final write ✓
- Live bash test: `deploy_init 7 → deploy_step → deploy_done deployed` correct ✓
- Double-source guard: `_EMIT_CI_STEP` preserved at 1 after second source ✓
- `bash -n scripts/lib/ci-utils.sh`: clean ✓
- File permissions: `-rw-r--r--` (not executable) ✓

### Follow-ups

- none
