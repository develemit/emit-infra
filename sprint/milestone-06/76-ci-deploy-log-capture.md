# Capture CI and deploy stdout/stderr to per-SHA log files
**Difficulty:** 3

## Goal
Every CI run and deploy run automatically writes its full terminal output to a log file keyed by git SHA. Log files are rotated to keep the 100 most recent per project. No changes are required to individual project scripts — capture is wired inside `ci_init` and `deploy_init`.

## Reason
When a CI run fails or a deploy behaves unexpectedly, the only place to check is the terminal where the push happened — which is gone. This sprint creates a permanent, browsable record of every run's output so failures can be diagnosed after the fact from the dashboard (sprints 77–78 add the API and UI to read them).

## Context
- `scripts/lib/ci-utils.sh` is the shared library sourced by all project `ci.sh` and `deploy.sh` scripts. It already captures metadata (SHA, branch, duration) to `.ci-history.jsonl` and `.deploy-history.jsonl`.
- The technique for capturing output is `exec > >(tee -a "$log_file") 2>&1` called inside `ci_init`/`deploy_init`. Because `exec` modifies the calling shell's file descriptors (not just the function's), all subsequent output from the sourcing script — build commands, docker output, error messages — flows through `tee` and is written to both the terminal and the log file simultaneously.
- `ci_step` and `deploy_step` write via `printf '...' > .ci-status.json` which uses an explicit file redirect that bypasses tee — so status JSON writes do NOT pollute the log. Only build/tool output is captured.
- Log files go in `.ci-logs/<sha>.log` and `.deploy-logs/<sha>.log` inside the project directory (alongside the existing JSONL files).
- Rotation uses `ls -t` (sort by modification time, newest first) and removes files beyond position 100. This keeps storage bounded regardless of run count.
- `_EMIT_LOG_FILE` and `_EMIT_DEPLOY_LOG_FILE` should be exported as globals so they can be referenced by other helpers if needed.
- The double-source guard (`_EMIT_CI_UTILS_LOADED`) means exec redirect is only set up once per shell session. This is correct.
- Make log capture failures non-fatal: wrap the `exec` line with `|| true` so a permissions failure doesn't abort the CI run itself.

## Tasks
1. In `ci_init`, after setting `_EMIT_SHA` and before writing `.ci-status.json`:
   - Create `.ci-logs/` directory with `mkdir -p .ci-logs`
   - Set `_EMIT_LOG_FILE=".ci-logs/${_EMIT_SHA}.log"`
   - Redirect output: `exec > >(tee -a "$_EMIT_LOG_FILE") 2>&1 || true`
2. In `deploy_init`, same pattern but `mkdir -p .deploy-logs` and `_EMIT_DEPLOY_LOG_FILE=".deploy-logs/${_EMIT_SHA}.log"`.
3. Add a `_emit_rotate_logs` function that accepts a directory and a max count (default 100):
   ```bash
   _emit_rotate_logs() {
     local dir="$1" max="${2:-100}"
     local files
     mapfile -t files < <(ls -t "$dir"/*.log 2>/dev/null)
     if [[ ${#files[@]} -gt $max ]]; then
       rm -f "${files[@]:$max}"
     fi
   }
   ```
4. Call `_emit_rotate_logs .ci-logs` at the end of `ci_done` (after the history append).
5. Call `_emit_rotate_logs .deploy-logs` at the end of `deploy_done` (after the history append).
6. Add `.ci-logs/` and `.deploy-logs/` to `.gitignore` inside each project that sources ci-utils. The projects are: `~/projects/tastease`, `~/projects/develemail`, `~/projects/emit-vision`, `~/projects/diner-decider`. Check each `.gitignore` and add both entries if not already present.
7. Verify with `bash -n scripts/lib/ci-utils.sh` — must pass clean.
8. Functional test: in a temp directory with a git repo, source the updated ci-utils.sh, run `ci_init 2 && echo "build output" && ci_step "step one" && ci_done success`. Confirm `.ci-logs/<sha>.log` exists and contains "build output". Confirm `.ci-status.json` does NOT appear in the log file.

## Files involved
- `scripts/lib/ci-utils.sh` — add `_EMIT_LOG_FILE`, `_EMIT_DEPLOY_LOG_FILE`, exec-tee redirect in `ci_init`/`deploy_init`, `_emit_rotate_logs` helper, rotate calls in `ci_done`/`deploy_done`
- `~/projects/tastease/.gitignore` — add `.ci-logs/` and `.deploy-logs/`
- `~/projects/develemail/.gitignore` — same
- `~/projects/emit-vision/.gitignore` — same
- `~/projects/diner-decider/.gitignore` — same (if it sources ci-utils)

## Acceptance criteria
- [x] After a CI run, `.ci-logs/<full-sha>.log` exists in the project directory containing the run's terminal output
- [x] After a deploy run, `.deploy-logs/<full-sha>.log` exists containing the deploy output
- [x] Status JSON writes (`ci_step`, `deploy_step`) do NOT appear in the log files
- [x] After 101+ runs, only the 100 most recent log files remain (older deleted)
- [x] A permissions failure creating the log dir does not abort the CI/deploy run
- [x] `bash -n scripts/lib/ci-utils.sh` passes
- [x] `.ci-logs/` and `.deploy-logs/` are in `.gitignore` for all project repos

## Completed

**Date:** 2026-06-20

### Summary
Added per-SHA log capture to `ci_init` and `deploy_init` in `ci-utils.sh`. Each function now creates a `.ci-logs/` or `.deploy-logs/` directory and opens a log file named `<sha>.log`, then redirects the calling shell's stdout/stderr through `tee` so all subsequent build output is written to both terminal and the log file simultaneously. Status JSON writes (`ci_step`, `deploy_step`, `ci_done`, `deploy_done`) use explicit `> file` redirects and bypass tee correctly — confirmed via grep on the log output.

Rotation uses `ls -t | tail -n +101 | xargs rm -f` (bash 3.2 compatible; `mapfile` was rejected as macOS ships bash 3.2). Log directory creation is guarded with `|| true` semantics via an `if mkdir -p ... 2>/dev/null` check, so permissions failures are non-fatal. `.ci-logs/` and `.deploy-logs/` added to `.gitignore` in all four project repos.

### Files changed
- `scripts/lib/ci-utils.sh` — added `_EMIT_LOG_FILE`, `_EMIT_DEPLOY_LOG_FILE` globals; `_emit_rotate_logs` helper; exec-tee redirect in `ci_init`/`deploy_init`; rotate calls in `ci_done`/`deploy_done`
- `~/projects/tastease/.gitignore` — added `.ci-logs/`, `.deploy-logs/`
- `~/projects/develemail/.gitignore` — same
- `~/projects/emit-vision/.gitignore` — same
- `~/projects/diner-decider/.gitignore` — same

### Verification
- `bash -n scripts/lib/ci-utils.sh`: clean
- CI cycle test (temp git repo): log file created at `.ci-logs/<sha>.log`, contains build output, zero status JSON entries
- Deploy cycle test: `.deploy-logs/<sha>.log` correct, history entry includes `servicesBuilt`
- Rotation test: 102 files → 100 after `_emit_rotate_logs`, oldest removed correctly

### Follow-ups
- `[defer]` Docker layer progress output (hundreds of `\r`-terminated lines) will appear in deploy logs. Raw output is readable but noisy. Could add `--quiet` flag to docker push/pull commands in individual deploy scripts if it becomes annoying.

## Out of scope
- API routes to serve log content (sprint 77)
- Dashboard UI to view logs (sprint 78)
- Filtering docker layer progress noise (can be done later if needed — raw output is fine for now)
- Log compression (storage is negligible at ~100KB per run × 100 files)
