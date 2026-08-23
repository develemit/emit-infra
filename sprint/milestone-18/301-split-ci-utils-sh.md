# Split scripts/lib/ci-utils.sh into focused modules
**Difficulty:** 4

> _Planned from sprint-297's Task 1 ("run /plan-sprint first"), 2026-08-23.
> Second of a three-part sequence (300 → 301 → 302). Requires sprint 300 to
> have landed so the extraction pattern (new lib file + `_LOADED` guard +
> sourcing update) is already proven._

## Goal
`scripts/lib/ci-utils.sh` (368 lines) is split into focused files under
`scripts/lib/`, each under ~250 lines, with every consumer's sourcing updated,
the shared `_EMIT_*` module state still working correctly across file
boundaries, and `pnpm test:hooks` still green under bash 3.2. No behavior
changes.

## Reason
This is the harder of the two lib splits (sprint 300 covered the easier one).
Unlike `deploy-plan.sh`, every cluster in this file reads and writes shared
module-level `_EMIT_*` variables — writer liveness, the heartbeat refresher,
signal handlers, and the finalize-once guards all depend on state set by
`ci_init`/`deploy_init`. A naive split by function name breaks that coupling
silently: bash has no import errors, so a missing variable is just empty
under `set -u`, or worse, not empty (stale from a previous source). Sprint
297 flagged this explicitly as the risky part of the whole initiative.

## Context
Read the file first: `scripts/lib/ci-utils.sh`. It has a
`_EMIT_CI_UTILS_LOADED` guard and ~20 lines of module-level state variables
(`_EMIT_SHA`, `_EMIT_STARTED_EPOCH`, `_EMIT_CI_HEARTBEAT_PID`, etc.) declared
right after the guard — every cluster below reads or writes some subset of
these.

Clusters (confirmed by reading the current file, 2026-08-23):
- **log capture**: `_emit_start_log`, `_emit_flush_log`, `_emit_rotate_logs`.
  Reads/writes `_EMIT_TEE_PID` only.
- **atomic writes + history**: `_emit_write_atomic`, `_emit_truncate_history`,
  `_emit_services_json`. `_emit_write_atomic` takes content/dest as args (no
  module state); `_emit_services_json` reads `_EMIT_SERVICES_BUILT`.
- **phase tracking**: `deploy_set_services`, `deploy_record_phase`,
  `_emit_close_phase`, `deploy_phase`, `_emit_phases_json`. Reads/writes
  `_EMIT_PHASES`, `_EMIT_PHASE_NAME`, `_EMIT_PHASE_EPOCH`,
  `_EMIT_SERVICES_BUILT`.
- **heartbeat**: `_emit_refresh_heartbeat`, `_emit_start_heartbeat`,
  `_emit_stop_heartbeat` (sprint 283). Reads/writes
  `_EMIT_CI_HEARTBEAT_PID`/`_EMIT_DEPLOY_HEARTBEAT_PID`; calls
  `_emit_write_atomic` from the atomic-writes cluster.
- **signal handling** (sprint 282): `_emit_reraise`,
  `_emit_ci_signal_handler`, `_emit_deploy_signal_handler`,
  `_emit_trap_signals`, `_emit_untrap_signals`. These call `ci_done`/
  `deploy_done` directly — a forward reference that's fine at runtime (the
  trap fires long after sourcing completes) but means whichever file defines
  these must be sourced *after* (or the shell must have fully sourced)
  whichever file defines `ci_done`/`deploy_done`, or simply: source order
  inside the "core" file's own sourcing of its sub-files must put writers
  before signal handlers, or the sub-files must not depend on definition
  order at all (bash doesn't care about definition order as long as nothing
  *calls* an undefined function before it's sourced — verify this holds).
- **ci writers**: `ci_init`, `ci_step`, `ci_done`. Own
  `_EMIT_CI_STEP`/`_EMIT_CI_TOTAL`/`_EMIT_CI_FINALIZED`; also set the shared
  `_EMIT_SHA`/`_EMIT_BRANCH`/`_EMIT_MSG`/`_EMIT_STARTED`/`_EMIT_STARTED_EPOCH`
  that deploy writers also read.
- **deploy writers**: `deploy_init`, `deploy_step`, `deploy_done`. Own
  `_EMIT_DEPLOY_STEP`/`_EMIT_DEPLOY_TOTAL`/`_EMIT_DEPLOY_FINALIZED`/
  `_EMIT_LAUNCH_MODE`/`_EMIT_LAUNCH_MARKER`; also read/write the shared
  `_EMIT_SHA`-family vars above.

**Recommended shape**: keep all module-level state declarations, the
`_EMIT_WRITER_PID`/`_EMIT_WRITER_HOST` computation, and the `ci_init`/
`ci_step`/`ci_done`/`deploy_init`/`deploy_step`/`deploy_done` writers together
in `ci-utils.sh` as the "core" file (writers touch nearly every piece of
state, so splitting them out buys little and risks the most). Extract
log-capture, atomic-writes-and-history, phase-tracking, heartbeat, and
signal-handling as separate files that `ci-utils.sh` sources internally
(each behind its own `_LOADED` guard), since those clusters have narrower,
well-defined state footprints. This should get the core file to ~200 lines
and each extracted file to 30-60 lines. Adjust if reading the code suggests
a better seam — the goal is correctness and low coupling risk, not a
mechanical 1:1 mapping of the list above to files.

**Consumers to update:**
- `scripts/hooks/pre-push` — sources `ci-utils.sh` directly (line ~19)
- `scripts/deploy-detached.sh` — check for direct or indirect sourcing
- `scripts/lib/hook-signals.test.sh`, `scripts/lib/deploy-liveness.test.sh`,
  `scripts/lib/deploy-unattended-gate.test.sh`, `scripts/lib/deploy-detached.test.sh`
  — these source `ci-utils.sh` (or will source the new split files) to test
  signal/heartbeat/writer behavior in isolation

`packages/core/src/deploy-records.ts` mirrors the JSON shapes `ci-utils.sh`
writes (see the file's header comment) — you are not changing any shape here,
just confirm no field name/type drifts as a side effect of the split.

**Bash 3.2.57 is the target.** No `declare -A`, no `${var^^}`.

## Tasks
1. Decide final file boundaries per the clusters above, keeping writers +
   state declarations together in `ci-utils.sh`.
2. Extract each lower-coupling cluster to its own `scripts/lib/*.sh` file
   with a `_LOADED` guard; have `ci-utils.sh` source them internally near the
   top (after its own guard check, before the state declarations that the
   sub-files might reference).
3. Update sourcing in every consumer listed in Context above (most only need
   to keep sourcing `ci-utils.sh` — it now transitively pulls in the rest —
   but verify no test suite sources an old cluster function's file path
   directly).
4. Run `bash -n` on every touched script.
5. Run `pnpm test:hooks` under `/bin/bash` (3.2) — assertion count must not
   drop from its current value (check with a baseline run before you start).
   Pay special attention to `hook-signals.test.sh` and `deploy-liveness.test.sh`
   — they exercise exactly the state coupling this split risks breaking.

## Files involved
- `scripts/lib/ci-utils.sh` — reduced to state + writers + internal sourcing
  of extracted clusters
- new files: `scripts/lib/*.sh` — one per extracted cluster (log capture,
  atomic writes/history, phase tracking, heartbeat, signal handling)
- `scripts/hooks/pre-push`, `scripts/deploy-detached.sh` — sourcing updates
  if needed
- `scripts/lib/hook-signals.test.sh`, `scripts/lib/deploy-liveness.test.sh`,
  `scripts/lib/deploy-unattended-gate.test.sh`,
  `scripts/lib/deploy-detached.test.sh` — sourcing updates if needed

## Acceptance criteria
- [x] `scripts/lib/ci-utils.sh` and every new extracted file are under ~250
      lines
- [x] `pnpm test:hooks` passes under bash 3.2 with the same or higher
      assertion count as the pre-split baseline, specifically including
      `hook-signals.test.sh` and `deploy-liveness.test.sh`
- [x] `bash -n` is clean on every touched script
- [x] Every consumer sources the correct file(s); no stale path to a moved
      function remains anywhere in the repo (`grep -r` for the old function
      names to confirm)
- [x] A manual smoke test (e.g. sourcing `ci-utils.sh` and running through
      `ci_init` → `ci_step` → `ci_done`, and `deploy_init` → a simulated
      signal → checking `.deploy-status.json` shows `interrupted`) confirms
      the cross-file state coupling still works, not just the existing test
      suite

## Out of scope
- `scripts/lib/deploy-plan.sh` — covered by sprint 300
- `scripts/hooks/pre-push` — covered by sprint 302
- Any behavior change or JSON shape change. This is a pure module
  reorganization.

## Completed

**Date:** 2026-08-23

### Summary
Split `scripts/lib/ci-utils.sh` (368 lines) into a thin "core" file plus five
narrow-footprint cluster files, following the exact pattern sprint 300
established for `deploy-plan.sh` (guard, `_LOADED` flag per file, core file
sources sub-files via its own `BASH_SOURCE`-resolved dir):

- `scripts/lib/ci-log-capture.sh` (43 lines) — `_emit_start_log`,
  `_emit_flush_log`, `_emit_rotate_logs`. Touches only `_EMIT_TEE_PID`.
- `scripts/lib/ci-atomic-write.sh` (37 lines) — `_emit_write_atomic`,
  `_emit_truncate_history`, `_emit_services_json`, `deploy_set_services`.
  `_emit_write_atomic` takes content/dest as plain args; the rest touch only
  `_EMIT_SERVICES_BUILT`.
- `scripts/lib/ci-phase-tracking.sh` (35 lines) — `deploy_record_phase`,
  `_emit_close_phase`, `deploy_phase`, `_emit_phases_json`. Touches
  `_EMIT_PHASES`/`_EMIT_PHASE_NAME`/`_EMIT_PHASE_EPOCH`.
- `scripts/lib/ci-heartbeat.sh` (77 lines) — `_emit_refresh_heartbeat`,
  `_emit_start_heartbeat`, `_emit_stop_heartbeat` (sprint 283). Touches
  `_EMIT_CI_HEARTBEAT_PID`/`_EMIT_DEPLOY_HEARTBEAT_PID`; calls
  `_emit_write_atomic` from the atomic-write cluster.
- `scripts/lib/ci-signals.sh` (59 lines) — `_emit_reraise`,
  `_emit_ci_signal_handler`, `_emit_deploy_signal_handler`,
  `_emit_trap_signals`, `_emit_untrap_signals` (sprint 282). Calls
  `ci_done`/`deploy_done`, which live in the core file — a forward reference
  that's safe because these only run later, as trap callbacks, by which time
  the whole module is fully sourced.
- `scripts/lib/ci-utils.sh` (198 lines, was 368) — kept its
  `_EMIT_CI_UTILS_LOADED` guard, the full module-level `_EMIT_*` state block,
  the writer pid/host computation, and all six writers
  (`ci_init`/`ci_step`/`ci_done`/`deploy_init`/`deploy_step`/`deploy_done`),
  since every one of them reads or writes several pieces of shared state and
  splitting them apart would multiply cross-file coupling risk for no
  file-size benefit.

Sourcing order in the core file is sub-files first, then state declarations —
matching the sprint's suggested shape. This is stylistic, not load-bearing:
every `_EMIT_*` read happens inside a function body, never at source time, so
bash resolves the variable whenever the function is later *called*, well
after the whole file has finished sourcing. Verified directly with the
signal-handler smoke test below, where `ci-signals.sh`'s forward reference to
`deploy_done` (defined later, in the core file) resolves correctly when the
trap fires.

Because every consumer (`pre-push`, and the four test files touching this
state) already sources `ci-utils.sh` by path rather than any individual
cluster function, **no consumer needed a sourcing change** — same
additive-plus-one-file-edit shape sprint 300 achieved for `deploy-plan.sh`.
Doc references to `ci-utils.sh` in `docs/PRE-PUSH-HOOK.md` and
`docs/DEPLOY-SIGNALS-AND-LIVENESS.md` remain accurate as-is: `ci-utils.sh` is
still the file that owns and documents `ci_init`/`ci_step`/writer-status
behavior, unlike sprint 300 where specific functions moved to differently-
named files.

### Files changed
- `scripts/lib/ci-utils.sh` — reduced to state + writers + internal sourcing
  of the five new cluster files
- (new) `scripts/lib/ci-log-capture.sh` — log-capture cluster
- (new) `scripts/lib/ci-atomic-write.sh` — atomic-write + history cluster
- (new) `scripts/lib/ci-phase-tracking.sh` — phase-timing cluster
- (new) `scripts/lib/ci-heartbeat.sh` — writer-liveness heartbeat cluster
- (new) `scripts/lib/ci-signals.sh` — signal-handling cluster

### Verification
- Baseline (`pnpm test:hooks` under `/bin/bash` 3.2.57, pre-split):
  47+7+12+6+12+17+34+25 = 160 assertions, 0 failed, exit 0.
- Post-split (same suites, same shell): identical per-suite counts
  (47/7/12/6/12/17/34/25), 0 failed, exit 0 — no regression, no drop.
  `hook-signals.test.sh` and `deploy-liveness.test.sh` both green.
- `pnpm test:hooks` (the actual npm-script command): 160/160 pass, exit 0.
- `bash -n`: clean on all 6 touched `scripts/lib/*.sh` files plus
  `scripts/hooks/pre-push`, `scripts/deploy-detached.sh`, and the four
  consumer test files.
- `grep -r` for every moved function name across the repo: only the new
  cluster files, `ci-utils.sh` itself, and `hook-signals.test.sh`/
  `deploy-liveness.test.sh` (which source `ci-utils.sh`, not a specific
  cluster file) reference them — no stale direct path to a moved function.
- Manual smoke test (`/bin/bash`, isolated tmp git repo, outside the test
  suite): `ci_init 3` → `ci_step` → `ci_done success` produced a valid
  terminal `.ci-status.json` and a matching `.ci-history.jsonl` line.
  `deploy_init 5 detached CLAUDECODE` → `_emit_trap_signals deploy` → a
  backgrounded `kill -TERM $$` → process exited 143 (128+15, signal-derived)
  and `.deploy-status.json`/`.deploy-history.jsonl` both show
  `"status":"interrupted"` with the `launch` block intact — confirms the
  `ci-signals.sh` → core-file `deploy_done` forward reference resolves
  correctly across the file boundary.
- Line counts: 198/43/37/35/77/59 — all comfortably under the ~250 target.

### Follow-ups
- `[defer]` `scripts/lib/ci-heartbeat.sh` at 77 lines is the largest new
  extract, almost entirely due to the block comment explaining the
  distinct-tmp-name race-avoidance rationale carried over from the original.
  Fine as-is; flagging only because it's the one file that didn't land near
  the 30-60 line range the sprint estimated for the other four.
- none (beyond the above observation)
