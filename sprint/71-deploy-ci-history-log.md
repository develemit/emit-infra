# Add deploy and CI history logs to ci-utils.sh
**Difficulty:** 2

## Goal
Every deploy and CI run leaves a permanent record in a JSONL history file alongside the existing point-in-time status files. This gives the dashboard (and future sprints) a timeline of all deploys and CI runs per project to correlate with resource metrics.

## Reason
Today `.deploy-status.json` and `.ci-status.json` are overwritten on every run — you can only see the most recent. To answer "did this deploy cause a memory spike?" you need a historical record of *when* each deploy happened, what SHA it shipped, how long it took, and which services were rebuilt. This sprint creates that record so the API and dashboard sprints that follow have data to work with.

## Context
- `scripts/lib/ci-utils.sh` is the shared library sourced by every project's `ci.sh` and `deploy.sh`.
- `deploy_done` and `ci_done` currently write a single JSON object to `.deploy-status.json` / `.ci-status.json`.
- The deploy scripts now track which services were built in a `TO_BUILD` array (added in the nx-affected sprint). This array should be captured in the history entry.
- All projects source ci-utils.sh from `$HOME/projects/emit-infra/scripts/lib/ci-utils.sh`.
- The history files go in the *project* directory (e.g. `~/projects/tastease/.deploy-history.jsonl`), not in emit-infra.

## Tasks
1. In `ci-utils.sh`, add a `_EMIT_SERVICES_BUILT` variable (default empty string) and a `deploy_set_services` helper that deploy scripts call after computing `TO_BUILD`:
   ```bash
   deploy_set_services() { _EMIT_SERVICES_BUILT="$*"; }
   ```
2. Modify `deploy_done` to also **append** a JSON line to `.deploy-history.jsonl` with: `status`, `sha`, `branch`, `startedAt`, `completedAt`, `durationSec`, `servicesBuilt` (array from `_EMIT_SERVICES_BUILT`).
3. Modify `ci_done` to also **append** a JSON line to `.ci-history.jsonl` with: `status`, `sha`, `branch`, `startedAt`, `completedAt`, `durationSec`.
4. Calculate `durationSec` as the difference between `_EMIT_STARTED` and `completedAt` using `date +%s`.
5. Update each project's deploy script (`develemail`, `tastease`, `emit-vision`) to call `deploy_set_services "${TO_BUILD[@]}"` right after the `TO_BUILD` array is computed (before `deploy_init`).
6. Add a size guard: if `.deploy-history.jsonl` exceeds 1000 lines, truncate to the newest 500 (tail -n 500 > tmpfile && mv). Same for `.ci-history.jsonl`.
7. Verify with `bash -n` on ci-utils.sh and all 6 scripts. Do a quick test: source ci-utils.sh in a subshell, call `ci_init 1; ci_step test; ci_done success` and confirm `.ci-history.jsonl` has one line.

## Files involved
- `scripts/lib/ci-utils.sh` — add `deploy_set_services`, append logic in `deploy_done` and `ci_done`, size guard
- `~/projects/develemail/scripts/deploy.sh` — add `deploy_set_services` call
- `~/projects/tastease/scripts/deploy.sh` — add `deploy_set_services` call
- `~/projects/emit-vision/scripts/deploy.sh` — add `deploy_set_services` call
- new file: `~/projects/<each>/.deploy-history.jsonl` (created automatically on first deploy)
- new file: `~/projects/<each>/.ci-history.jsonl` (created automatically on first CI run)

## Acceptance criteria
- [x] `deploy_done` appends one JSON line to `.deploy-history.jsonl` with all fields
- [x] `ci_done` appends one JSON line to `.ci-history.jsonl` with all fields
- [x] History entry includes `servicesBuilt` array for deploys
- [x] History files are auto-truncated at 1000 lines
- [x] `.deploy-status.json` and `.ci-status.json` still work as before (overwrite, not append)
- [x] `bash -n` passes on ci-utils.sh and all 6 project scripts
- [x] Commit to emit-infra + all 3 project repos

## Out of scope
- API routes to serve history (sprint 73)
- Dashboard UI for history (sprints 74-75)
- Per-container metrics (sprint 72)

## Completed

**Date:** 2026-06-18

### Summary
Added history logging to ci-utils.sh. `ci_done` and `deploy_done` now append a JSON line to `.ci-history.jsonl` and `.deploy-history.jsonl` respectively, alongside the existing status-file overwrite. Deploy history entries include a `servicesBuilt` array populated via the new `deploy_set_services` helper. Both history files auto-truncate at 1000 lines (keeping the newest 500). All three project deploy scripts (develemail, tastease, emit-vision) were updated to call `deploy_set_services` after computing `TO_BUILD`.

### Files changed
- `scripts/lib/ci-utils.sh` — added `_EMIT_STARTED_EPOCH`, `_EMIT_SERVICES_BUILT`, `deploy_set_services()`, `_emit_services_json()`, `_emit_truncate_history()`, and append logic in `ci_done`/`deploy_done`
- `~/projects/develemail/scripts/deploy.sh` — added `deploy_set_services` call
- `~/projects/tastease/scripts/deploy.sh` — added `deploy_set_services` call
- `~/projects/emit-vision/scripts/deploy.sh` — added `deploy_set_services` call

### Verification
- `bash -n` on all 7 scripts: clean
- Functional test (source + ci cycle + deploy cycle): valid JSON, `servicesBuilt: ["web","api","worker"]`, durationSec is int
- Truncation test (1005 lines → 500 lines): correct, preserves newest entries

### Follow-ups
none
